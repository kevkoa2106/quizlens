import argparse
import hmac
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from backend.core import Solver, extract_image
from backend.local_api import LocalAPIError, analyze_local

MAX_BODY = 17 * 1024 * 1024


def make_handler(token, solver, extract=extract_image, local_solver=analyze_local):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def origin_allowed(self):
            origin = self.headers.get('Origin')
            return origin is None or (urlparse(origin).scheme in ('chrome-extension', 'moz-extension') and
                                      bool(urlparse(origin).netloc) and urlparse(origin).path == '')

        def reply(self, status, body):
            content = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            if self.origin_allowed() and self.headers.get('Origin'):
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
                self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def do_OPTIONS(self):
            self.reply(200 if self.origin_allowed() else 403, {})

        def do_POST(self):
            if not self.origin_allowed():
                return self.reply(403, dict(error='Only extension requests are allowed.'))
            if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + token).encode()):
                return self.reply(401, dict(error='Paste the service token into the extension settings.'))
            if self.path not in ('/extract', '/analyze'):
                return self.reply(404, dict(error='Unknown endpoint.'))
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > MAX_BODY:
                    return self.reply(413, dict(error='Request is empty or too large.'))
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError('Expected a JSON object.')
                if self.path == '/extract':
                    result = extract(payload.get('image'))
                elif payload.get('provider', 'laya') == 'laya':
                    if payload.get('input_mode') == 'image':
                        raise ValueError('Image input requires a vision-capable local API model. Laya accepts text only.')
                    result = solver.analyze(payload)
                elif payload.get('provider') == 'local_api':
                    result = local_solver(payload)
                else:
                    raise ValueError('Select Laya or a local model API.')
                self.reply(200, result)
            except LocalAPIError as exc:
                self.reply(502, dict(error=str(exc)))
            except (ValueError, UnicodeError) as exc:
                self.reply(400, dict(error=str(exc)))
            except Exception as exc:
                print(f'{type(exc).__name__}: {exc}', flush=True)
                self.reply(503, dict(error='Local processing failed. Check the service terminal for OCR or model setup errors.'))
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    token = secrets.token_urlsafe(32)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(token, Solver()))
    print(f'Local service: http://127.0.0.1:{args.port}\nService token: {token}', flush=True)
    print('Paste the token into the extension. First analysis downloads the Laya checkpoint.', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
