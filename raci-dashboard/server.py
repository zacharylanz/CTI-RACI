"""
Flask server — serves the dashboard and handles file uploads.
"""

import json
import os

from flask import Flask, Response, request, send_from_directory

from parser import parse_file_from_bytes

# Resolve paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, 'web')


def create_app(initial_data=None):
    app = Flask(__name__, static_folder=WEB_DIR, static_url_path='')
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB max upload

    # Store current data
    app.raci_data = initial_data

    @app.route('/')
    def index():
        return send_from_directory(WEB_DIR, 'index.html')

    @app.route('/api/data')
    def get_data():
        if app.raci_data is None:
            return Response(
                json.dumps({'error': 'No data loaded. Upload a file.'}),
                status=404,
                mimetype='application/json'
            )
        return Response(
            json.dumps(app.raci_data, ensure_ascii=False),
            mimetype='application/json'
        )

    @app.route('/api/upload', methods=['POST'])
    def upload():
        if 'file' not in request.files:
            return Response(
                json.dumps({'error': 'No file provided'}),
                status=400,
                mimetype='application/json'
            )
        f = request.files['file']
        if not f.filename:
            return Response(
                json.dumps({'error': 'No file selected'}),
                status=400,
                mimetype='application/json'
            )
        sheet = request.form.get('sheet')
        try:
            data = parse_file_from_bytes(
                f.read(), f.filename, sheet_name=sheet or None
            )
            app.raci_data = data
            return Response(
                json.dumps(data, ensure_ascii=False),
                mimetype='application/json'
            )
        except ValueError as e:
            return Response(
                json.dumps({'error': str(e)}),
                status=422,
                mimetype='application/json'
            )
        except Exception as e:
            return Response(
                json.dumps({'error': f'Failed to parse file: {e}'}),
                status=500,
                mimetype='application/json'
            )

    return app


def run_server(data, host='127.0.0.1', port=8080):
    app = create_app(initial_data=data)
    app.run(host=host, port=port, debug=False)
