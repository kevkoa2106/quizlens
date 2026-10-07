import base64
import io
import json
import math
import os
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock

from backend.core import Solver, average_answers, extract_image, parse_ocr, validate_question
from backend.server import make_handler
from backend.local_api import LocalAPIError


class CoreTests(unittest.TestCase):
    def test_question_validation(self):
        self.assertEqual(validate_question({'question': ' Why? ', 'options': [' A ', 'B']}), ('Why?', ['A', 'B']))
        for payload in ({}, {'question': 'Q', 'options': ['a', 'A']}, {'question': 'Q', 'options': ['x']},
                        {'question': 'Q', 'options': [None, 'b']}, {'question': 'x' * 2001, 'options': ['a', 'b']}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_question(payload)

    def test_average_keeps_option_identity(self):
        rows = {'a': {'probabilities': {'0': .8, '1': .2}}, 'b': {'probabilities': {'0': .6, '1': .4}}}
        result = average_answers(rows, ['Ciphertext', 'Plaintext'])
        self.assertEqual(result['answers'][0]['text'], 'Ciphertext')
        self.assertAlmostEqual(result['answers'][0]['probability'], .7)
        self.assertFalse(result['calibrated'])

    def test_invalid_probabilities_fail(self):
        for values in ([math.nan, .2], [-.1, 1.1], [.3, .3]):
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                average_answers({'x': {'probabilities': dict(zip(['0', '1'], values))}}, ['a', 'b'])

    def test_laya_tie_chooses_first_original_option_without_changing_scores(self):
        result = average_answers({'x': {'probabilities': {'0': .5, '1': .5}}}, ['a', 'b'])
        self.assertEqual(result['chosen_index'], 0)
        self.assertTrue(result['tied'])
        self.assertTrue(result['uncertain'])
        self.assertEqual([row['probability'] for row in result['answers']], [.5, .5])

    def test_solver_balances_all_slots(self):
        router = Mock()
        router.predict.return_value = {'answers': {'0': {'probabilities': {'0': .1, '1': .9}},
                                                   '1': {'probabilities': {'0': .3, '1': .7}}},
                                       'routing': {'model': 'english'}}
        result = Solver(router).analyze({'question': 'Q?', 'options': ['a', 'b']})
        self.assertEqual(result['answers'][0]['index'], 1)
        questions = router.predict.call_args.args[1]
        self.assertEqual([q['option_order'] for q in questions.values()], [[0, 1], [1, 0]])
        self.assertEqual(questions['0']['criteria'], {'0': 'a', '1': 'b'})

    def test_missing_question_is_editable(self):
        result = parse_ocr(dict(text=['Unclear'], conf=['80'], left=[0], top=[0], width=[100], height=[20]))
        self.assertEqual(result['question'], '')
        self.assertEqual(result['raw_text'], 'Unclear')

    def test_image_validation(self):
        for value in ('no', 'data:image/png;base64,@@@@', 'data:image/png;base64,' + base64.b64encode(b'bad').decode()):
            with self.subTest(value=value), self.assertRaises(ValueError):
                extract_image(value)

    def test_real_ocr_fixture(self):
        path = Path(__file__).parent / 'quiz.png'
        result = extract_image('data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode())
        self.assertIn('encryption algorithm?', result['question'])
        # Tesseract builds can add a trailing period to the same tile label.
        self.assertEqual([option.rstrip('.') for option in result['options']],
                         ['Ciphertext', 'Payload', 'Source code', 'Plaintext'])

    def test_math_question_without_question_mark(self):
        image = 'data:image/png;base64,' + base64.b64encode((Path(__file__).parent / 'math-quiz.png').read_bytes()).decode()
        result = extract_image(image)
        self.assertEqual(result['question'], '3x9')
        self.assertFalse(any('Continue' in option for option in result['options']))

    @unittest.skipUnless(os.environ.get('LAYA_INTEGRATION') == '1', 'Set LAYA_INTEGRATION=1 to load the real checkpoint.')
    def test_real_laya(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler('integration-token', Solver()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def post(path, payload):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=600)
            connection.request('POST', path, json.dumps(payload), {'Authorization': 'Bearer integration-token', 'Content-Type': 'application/json'})
            response = connection.getresponse()
            content = json.loads(response.read())
            connection.close()
            self.assertEqual(response.status, 200, content)
            return content
        try:
            image = 'data:image/png;base64,' + base64.b64encode((Path(__file__).parent / 'quiz.png').read_bytes()).decode()
            extracted = post('/extract', {'image': image})
            result = post('/analyze', extracted)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(len(result['answers']), 4)
        self.assertAlmostEqual(sum(row['probability'] for row in result['answers']), 1, places=3)
        self.assertEqual(sorted(row['index'] for row in result['answers']), [0, 1, 2, 3])
        print('\nLive Laya result:', json.dumps(result))


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.solver = Mock()
        cls.solver.analyze.return_value = {'answers': []}
        cls.local_solver = Mock(return_value={'model': 'local-test', 'answers': []})
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler('secret', cls.solver, lambda image: {'question': 'Q?', 'options': ['a', 'b']}, cls.local_solver))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def call(self, path='/analyze', body='{}', token='secret', origin='chrome-extension://test', method='POST'):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        connection.request(method, path, body, {'Authorization': 'Bearer ' + token, 'Origin': origin, 'Content-Type': 'application/json'})
        response = connection.getresponse()
        result = response.status, json.loads(response.read()), dict(response.getheaders())
        connection.close()
        return result

    def test_authorization_and_origin(self):
        self.assertEqual(self.call(token='wrong')[0], 401)
        result = self.call(origin='https://evil.example')
        self.assertEqual(result[0], 403)
        self.assertNotIn('Access-Control-Allow-Origin', result[2])

    def test_preflight(self):
        self.assertEqual(self.call(method='OPTIONS')[0], 200)
        self.assertEqual(self.call(origin='moz-extension://test', method='OPTIONS')[0], 200)
        status, _, headers = self.call(origin='moz-extension://test')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'moz-extension://test')

    def test_bad_requests(self):
        for body in ('not json', '[]', ''):
            self.assertIn(self.call(body=body)[0], (400, 413))
        self.assertEqual(self.call(path='/missing')[0], 404)

    def test_provider_dispatch(self):
        payload = {'provider': 'local_api', 'question': 'Q?', 'options': ['a', 'b'], 'model': 'local-test'}
        self.assertEqual(self.call(body=json.dumps(payload))[1]['model'], 'local-test')
        self.local_solver.assert_called_with(payload)
        self.assertEqual(self.call(body=json.dumps({'provider': 'unknown'}))[0], 400)
        self.assertEqual(self.call(body=json.dumps({'provider': 'laya', 'input_mode': 'image'}))[0], 400)

    def test_unauthorized_requests_never_invoke_models(self):
        self.solver.reset_mock()
        self.local_solver.reset_mock()
        self.assertEqual(self.call(token='wrong')[0], 401)
        self.assertEqual(self.call(origin='https://example.com')[0], 403)
        self.solver.analyze.assert_not_called()
        self.local_solver.assert_not_called()

    def test_processing_errors_reach_the_panel_without_exception_details(self):
        try:
            self.local_solver.side_effect = LocalAPIError('Incomplete model JSON.')
            status, body, _ = self.call(body='{"provider":"local_api"}')
            self.assertEqual(status, 502)
            self.assertEqual(body['error'], 'Incomplete model JSON.')
            self.solver.analyze.side_effect = ValueError('Enter two options.')
            self.assertEqual(self.call()[0], 400)
            self.solver.analyze.side_effect = RuntimeError('private debug details')
            status, body, _ = self.call()
            self.assertEqual(status, 503)
            self.assertNotIn('private debug details', body['error'])
        finally:
            self.local_solver.side_effect = None
            self.solver.analyze.side_effect = None

    def test_invalid_body_lengths_are_rejected_before_reading(self):
        for length, expected in [('0', 413), ('-1', 413), (str(18 * 1024 * 1024), 413), ('invalid', 400)]:
            with self.subTest(length=length):
                connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
                connection.request('POST', '/analyze', b'', {'Authorization': 'Bearer secret', 'Content-Length': length})
                response = connection.getresponse()
                response.read()
                connection.close()
                self.assertEqual(response.status, expected)

    def test_extract_and_analyze(self):
        self.assertEqual(self.call(path='/extract')[1]['question'], 'Q?')
        self.assertEqual(self.call()[0], 200)


if __name__ == '__main__':
    unittest.main()
