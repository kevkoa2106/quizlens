import base64
import io
import math
import re
import threading

MAX_IMAGE_BYTES = 12 * 1024 * 1024


def validate_question(payload):
    question = payload.get('question')
    options = payload.get('options')
    if not isinstance(question, str) or not question.strip() or len(question) > 2000:
        raise ValueError('Enter a question of 1 to 2000 characters.')
    if not isinstance(options, list) or not 2 <= len(options) <= 8:
        raise ValueError('Enter 2 to 8 answer options, one per line.')
    if any(not isinstance(x, str) or not x.strip() or len(x) > 500 for x in options):
        raise ValueError('Each option must contain 1 to 500 characters.')
    options = [x.strip() for x in options]
    if len(set(x.casefold() for x in options)) != len(options):
        raise ValueError('Answer options must be distinct.')
    return question.strip(), options


def parse_ocr(data):
    words = []
    for i, value in enumerate(data['text']):
        if value.strip() and float(data['conf'][i]) >= 0:
            words.append(dict(text=value.strip(), x=int(data['left'][i]),
                              y=int(data['top'][i]), w=int(data['width'][i]),
                              h=int(data['height'][i])))
    rows = []
    for word in sorted(words, key=lambda w: (w['y'] + w['h'] / 2, w['x'])):
        center = word['y'] + word['h'] / 2
        row = next((r for r in rows if abs(r['center'] - center) < max(word['h'], r['height']) * .55), None)
        if row is None:
            row = dict(center=center, height=word['h'], words=[])
            rows.append(row)
        row['words'].append(word)
    rows.sort(key=lambda r: r['center'])
    lines = [' '.join(w['text'] for w in sorted(r['words'], key=lambda w: w['x'])) for r in rows]
    end = next((i for i, line in enumerate(lines) if '?' in line), None)
    if end is None:
        end = next((i for i, line in enumerate(lines) if re.fullmatch(
            r'\s*[()\d.,+−\-*/÷×xX=^\s]+\s*', line) and re.search(r'\d\s*[+−\-*/÷×xX^]\s*\d', line)), None)
        if end is None:
            return dict(question='', options=[], raw_text='\n'.join(lines))
    start = end
    while start > 0 and rows[start]['center'] - rows[start - 1]['center'] < 3 * max(rows[start]['height'], rows[start - 1]['height']):
        start -= 1
    options = []
    # ponytail: one-row answer groups; wrapped or unusual layouts need manual correction.
    for row in rows[end + 1:]:
        if re.search(r'press\s+anywhere\s+to\s+continue', ' '.join(w['text'] for w in sorted(row['words'], key=lambda w: w['x'])), re.I):
            continue
        groups = [[]]
        previous = None
        for word in sorted(row['words'], key=lambda w: w['x']):
            if word['text'] in ('x', 'X', 'v', '✓', '✕', '×', '>', '|'):
                continue
            if previous and word['x'] - previous['x'] - previous['w'] > max(40, row['height'] * 3):
                groups.append([])
            groups[-1].append(word['text'])
            previous = word
        options.extend(re.sub(r'^[A-Ha-h][.)]\s+', '', ' '.join(g)) for g in groups if g)
    return dict(question=' '.join(lines[start:end + 1]), options=options[:8], raw_text='\n'.join(lines))


def extract_image(data_url):
    from PIL import Image, UnidentifiedImageError
    import pytesseract
    if not isinstance(data_url, str) or not data_url.startswith('data:image/png;base64,'):
        raise ValueError('Expected a PNG screenshot.')
    try:
        raw = base64.b64decode(data_url.split(',', 1)[1], validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError('Screenshot is too large.')
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != 'PNG' or image.width * image.height > 20_000_000:
                raise ValueError('Screenshot must be a PNG under 20 megapixels.')
            image = image.convert('RGB')
            data = pytesseract.image_to_data(image, config='--psm 11',
                                             output_type=pytesseract.Output.DICT, timeout=30)
            # Solid quiz tiles need isolated OCR; full-page segmentation misses white labels.
            from collections import Counter
            import numpy as np
            thumb = image.copy()
            thumb.thumbnail((600, 600))
            pixels = np.asarray(thumb) // 32
            counts = Counter(map(tuple, pixels.reshape(-1, 3)))
            for color, count in counts.items():
                if count < thumb.width * thumb.height * .06 or max(color) - min(color) < 2:
                    continue
                ys, xs = np.where(np.all(pixels == color, axis=2))
                left = int(xs.min() * image.width / thumb.width)
                top = int(ys.min() * image.height / thumb.height)
                right = int((xs.max() + 1) * image.width / thumb.width)
                bottom = int((ys.max() + 1) * image.height / thumb.height)
                if bottom - top < image.height * .08:
                    continue
                tile = pytesseract.image_to_data(image.crop((left, top, right, bottom)), config='--psm 6',
                                                output_type=pytesseract.Output.DICT, timeout=30)
                if not any(text.strip() for text in tile['text']):
                    from PIL import ImageOps
                    high_contrast = ImageOps.grayscale(image.crop((left, top, right, bottom))).point(lambda value: 0 if value > 220 else 255)
                    tile = pytesseract.image_to_data(high_contrast, config='--psm 6',
                                                    output_type=pytesseract.Output.DICT, timeout=30)
                keep = [i for i in range(len(data['text'])) if not
                        (left <= data['left'][i] + data['width'][i] / 2 <= right and
                         top <= data['top'][i] + data['height'][i] / 2 <= bottom)]
                data = {key: [values[i] for i in keep] for key, values in data.items()}
                tile['left'] = [x + left for x in tile['left']]
                tile['top'] = [y + top for y in tile['top']]
                for key in data:
                    data[key].extend(tile[key])
        return parse_ocr(data)
    except (UnidentifiedImageError, Image.DecompressionBombError, base64.binascii.Error) as exc:
        raise ValueError('Screenshot could not be decoded.') from exc


def average_answers(answers, options):
    labels = [str(i) for i in range(len(options))]
    values = []
    for label in labels:
        samples = [answer['probabilities'][label] for answer in answers.values()]
        if any(not isinstance(p, (float, int)) or isinstance(p, bool) or not math.isfinite(p) or not 0 <= p <= 1 for p in samples):
            raise RuntimeError('Laya returned invalid probabilities.')
        values.append(sum(samples) / len(samples))
    if not math.isclose(sum(values), 1, abs_tol=.001):
        raise RuntimeError('Laya returned a probability distribution that does not sum to one.')
    ranked = sorted([dict(index=i, text=text, probability=values[i]) for i, text in enumerate(options)],
                    key=lambda row: row['probability'], reverse=True)
    return dict(answers=ranked, chosen_index=ranked[0]['index'],
                tied=math.isclose(ranked[0]['probability'], ranked[1]['probability'], abs_tol=1e-9, rel_tol=0),
                uncertain=ranked[0]['probability'] < .7,
                calibrated=False, threshold=.7)


class Solver:
    def __init__(self, router=None):
        self.router = router
        self.lock = threading.Lock()

    def analyze(self, payload):
        question, options = validate_question(payload)
        criteria = {str(i): text for i, text in enumerate(options)}
        questions = {str(rotation): dict(type='choice', instructions='Select the correct answer to the question.',
                     criteria=criteria, option_order=[(i + rotation) % len(options) for i in range(len(options))])
                     for rotation in range(len(options))}
        # ponytail: serialize local inference; use a job queue if concurrent users are needed.
        with self.lock:
            if self.router is None:
                from laya import Router
                self.router = Router()
            prediction = self.router.predict(question, questions, max_len=2048, head_max_len=2048)
        result = average_answers(prediction['answers'], options)
        result['model'] = prediction.get('routing', {}).get('model', 'laya')
        return result
