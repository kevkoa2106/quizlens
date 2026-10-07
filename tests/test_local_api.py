import base64
import io
import json
from pathlib import Path
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.local_api import LocalAPIError, analyze_local, prepare_image, validate_settings


class LocalAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                cls.received = (self.path, dict(self.headers), json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(cls.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Location', 'http://example.com/forbidden')
                self.end_headers()
                self.wfile.write(json.dumps(cls.response).encode())
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        type(self).status = 200
        type(self).response = {'choices': [{'message': {'content': '{"probabilities": [0.1, 0.9]}'}}]}
        self.payload = dict(question='3x9', options=['32', '27'], model='local-test-model', api_key='local-secret',
                            base_url=f'http://localhost:{self.server.server_port}/v1')

    def test_openai_compatible_request_and_answer_identity(self):
        result = analyze_local(self.payload)
        path, headers, body = self.received
        self.assertEqual(path, '/v1/chat/completions')
        self.assertEqual(headers['Authorization'], 'Bearer local-secret')
        self.assertEqual(body['model'], 'local-test-model')
        self.assertFalse(body['stream'])
        self.assertEqual(body['max_tokens'], 512)
        self.assertEqual(body['chat_template_kwargs'], {'enable_thinking': False})
        schema = body['response_format']['json_schema']['schema']['properties']['probabilities']
        self.assertEqual(schema['minItems'], 2)
        self.assertEqual(schema['maxItems'], 2)
        self.assertEqual(json.loads(body['messages'][1]['content'])['options'], ['32', '27'])
        self.assertEqual(result['answers'][0]['index'], 1)
        self.assertEqual(result['answers'][0]['text'], '27')
        self.assertFalse(result['calibrated'])
        self.assertEqual(result['method'], 'model-reported estimates')

    def test_explicit_choice_and_short_decisive_prompt(self):
        type(self).response['choices'][0]['message']['content'] = '{"best_index":1,"probabilities":[0.1,0.9]}'
        result = analyze_local(self.payload)
        self.assertEqual(result['chosen_index'], 1)
        self.assertFalse(result['tied'])
        self.assertEqual(result['choice_source'], 'model')
        schema = self.received[2]['response_format']['json_schema']['schema']
        self.assertIn('best_index', schema['required'])
        self.assertEqual(schema['properties']['best_index']['maximum'], 1)
        self.assertIn('unique highest', self.received[2]['messages'][0]['content'])

    def test_tied_estimates_keep_model_choice_without_fabricating_scores(self):
        for count in (2, 3, 4):
            probabilities = [1 / count] * count
            type(self).response['choices'][0]['message']['content'] = json.dumps({'best_index': count - 1, 'probabilities': probabilities})
            result = analyze_local(dict(self.payload, options=[str(i) for i in range(count)]))
            self.assertEqual(result['chosen_index'], count - 1)
            self.assertTrue(result['tied'])
            self.assertTrue(result['uncertain'])
            self.assertEqual([row['probability'] for row in result['answers']], probabilities)

    def test_invalid_or_inconsistent_choice_is_rejected(self):
        for index in (True, -1, 2, '1', 0):
            type(self).response['choices'][0]['message']['content'] = json.dumps({'best_index': index, 'probabilities': [.1, .9]})
            with self.subTest(index=index), self.assertRaises(LocalAPIError):
                analyze_local(self.payload)

    def test_code_fences_are_accepted(self):
        type(self).response['choices'][0]['message']['content'] = '```json\n{"probabilities": [0.5, 0.5]}\n```'
        self.assertTrue(analyze_local(self.payload)['uncertain'])

    def test_invalid_model_output_is_rejected(self):
        for content in ('not JSON', '{"probabilities": [0.4]}', '{"probabilities": [0.2, 0.2]}',
                        '{"probabilities": [NaN, 0.2]}', '{"probabilities": [true, false]}'):
            type(self).response['choices'][0]['message']['content'] = content
            with self.subTest(content=content), self.assertRaises(LocalAPIError):
                analyze_local(self.payload)

    def test_complete_json_in_reasoning_field_is_accepted(self):
        type(self).response = {'choices': [{'message': {'content': '', 'reasoning_content': '{"probabilities":[0.1,0.9]}'}, 'finish_reason': 'stop'}]}
        self.assertEqual(analyze_local(self.payload)['answers'][0]['text'], '27')

    def test_truncated_response_does_not_mine_reasoning_prose(self):
        type(self).response = {'choices': [{'message': {'content': '{"probabilities":[1.0,',
            'reasoning_content': 'Thinking: the answer should be {"probabilities":[1.0,0.0]}'}, 'finish_reason': 'length'}]}
        with self.assertRaisesRegex(LocalAPIError, 'output token limit'):
            analyze_local(self.payload)
        type(self).response['choices'][0]['message']['content'] = ''
        with self.assertRaises(LocalAPIError):
            analyze_local(self.payload)

    def test_complete_final_answer_wins_over_reasoning(self):
        type(self).response['choices'][0]['message']['reasoning_content'] = '{"probabilities":[1,0]}'
        self.assertEqual(analyze_local(self.payload)['answers'][0]['text'], '27')

    def test_advanced_options_can_be_disabled_and_budget_changed(self):
        analyze_local(dict(self.payload, structured_json=False, no_thinking=False, max_tokens=2048))
        body = self.received[2]
        self.assertNotIn('response_format', body)
        self.assertNotIn('chat_template_kwargs', body)
        self.assertEqual(body['max_tokens'], 2048)
        for bad in (True, 0, 99999, '512'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                analyze_local(dict(self.payload, max_tokens=bad))

    def test_vision_request_embeds_image_and_preserves_inferred_options(self):
        image = 'data:image/png;base64,' + base64.b64encode((Path(__file__).parent / 'quiz.png').read_bytes()).decode()
        type(self).response['choices'][0]['message']['content'] = json.dumps({'question': 'Encryption output?', 'options': ['Ciphertext', 'Plaintext'], 'probabilities': [.9, .1]})
        result = analyze_local(dict(self.payload, input_mode='image', image=image))
        content = self.received[2]['messages'][1]['content']
        self.assertEqual(content[1]['type'], 'image_url')
        self.assertTrue(content[1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
        from PIL import Image
        with Image.open(io.BytesIO(base64.b64decode(content[1]['image_url']['url'].split(',', 1)[1]))) as prepared:
            self.assertLessEqual(max(prepared.size), 1600)
        self.assertEqual(result['question'], 'Encryption output?')
        self.assertEqual(result['options'], ['Ciphertext', 'Plaintext'])
        self.assertEqual(result['answers'][0]['text'], 'Ciphertext')
        required = self.received[2]['response_format']['json_schema']['schema']['required']
        self.assertEqual(required, ['question', 'options', 'best_index', 'probabilities'])

    def test_image_validation_rejects_remote_urls_and_corrupt_files(self):
        for image in ('https://example.com/image.png', 'data:image/png;base64,@@',
                      'data:image/png;base64,' + base64.b64encode(b'not an image').decode()):
            with self.subTest(image=image), self.assertRaises(ValueError):
                prepare_image(image)

    def test_vision_response_requires_matching_options_and_probabilities(self):
        image = 'data:image/png;base64,' + base64.b64encode((Path(__file__).parent / 'quiz.png').read_bytes()).decode()
        for response in ({'probabilities': [.5, .5]}, {'question': 'Q?', 'options': ['a', 'b', 'c'], 'probabilities': [.5, .5]}):
            type(self).response['choices'][0]['message']['content'] = json.dumps(response)
            with self.subTest(response=response), self.assertRaises(LocalAPIError):
                analyze_local(dict(self.payload, input_mode='image', image=image))

    def test_http_errors_and_redirects_do_not_follow_remote_urls(self):
        for status in (401, 404, 302):
            type(self).status = status
            with self.subTest(status=status), self.assertRaisesRegex(LocalAPIError, f'HTTP {status}'):
                analyze_local(self.payload)

    def test_local_endpoint_validation(self):
        for url in ('https://example.com/v1', 'http://example.com/v1', 'http://127.0.0.1@evil.example/v1',
                    'http://localhost/v1?key=secret', 'http://localhost/v1#fragment'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_settings(dict(self.payload, base_url=url))
        with self.assertRaises(ValueError):
            validate_settings(dict(self.payload, model=''))
        with self.assertRaises(ValueError):
            validate_settings(dict(self.payload, api_key='key\r\nX-Header: injected'))
        self.assertEqual(validate_settings(dict(self.payload, base_url='http://[::1]:1234/v1'))[0],
                         'http://[::1]:1234/v1/chat/completions')


if __name__ == '__main__':
    unittest.main()
