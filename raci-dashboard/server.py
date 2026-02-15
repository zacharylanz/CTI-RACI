"""
Flask server — serves the dashboard and handles file uploads and exports.
"""

import io
import json
import os
import tempfile
import zipfile

from flask import Flask, Response, request, send_from_directory, send_file

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

    @app.route('/api/export/html', methods=['POST'])
    def export_html_endpoint():
        """Export self-contained HTML dashboard. Accepts data as POST JSON body."""
        from export import export_html
        data = request.get_json() or app.raci_data
        if not data:
            return Response(json.dumps({'error': 'No data'}), status=400, mimetype='application/json')

        with tempfile.NamedTemporaryFile(suffix='.html', delete=False) as tmp:
            tmp_path = tmp.name
        try:
            export_html(data, tmp_path)
            with open(tmp_path, 'rb') as f:
                buf = io.BytesIO(f.read())
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        return send_file(
            buf,
            mimetype='text/html',
            as_attachment=True,
            download_name='raci-dashboard.html'
        )

    @app.route('/api/export/powerbi', methods=['POST'])
    def export_powerbi_endpoint():
        """Export Power BI starter kit as a ZIP file. Accepts data as POST JSON body."""
        from export import export_powerbi
        data = request.get_json() or app.raci_data
        if not data:
            return Response(json.dumps({'error': 'No data'}), status=400, mimetype='application/json')

        with tempfile.TemporaryDirectory() as tmpdir:
            files = export_powerbi(data, tmpdir)
            # Create ZIP in memory
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
                for fp in files:
                    zf.write(fp, os.path.basename(fp))
            buf.seek(0)
            return send_file(
                buf,
                mimetype='application/zip',
                as_attachment=True,
                download_name='raci-powerbi-kit.zip'
            )

    @app.route('/api/raci/cell', methods=['PUT'])
    def update_raci_cell():
        """Update a single RACI cell assignment."""
        body = request.get_json()
        if not body or not app.raci_data:
            return Response(json.dumps({'error': 'No data'}), status=400, mimetype='application/json')
        cat_name = body.get('category')
        cap_name = body.get('capability')
        role_id = body.get('role_id')
        value = body.get('value', '')
        for cat in app.raci_data['categories']:
            if cat['name'] == cat_name:
                for item in cat['items']:
                    if item['name'] == cap_name:
                        if value and value in ('R', 'A', 'C', 'I'):
                            item[role_id] = value
                        elif role_id in item:
                            del item[role_id]
                        return Response(json.dumps({'ok': True}), mimetype='application/json')
        return Response(json.dumps({'error': 'Not found'}), status=404, mimetype='application/json')

    @app.route('/api/raci/maturity', methods=['PUT'])
    def update_raci_maturity():
        """Update a maturity score (now or tgt) for a capability."""
        body = request.get_json()
        if not body or not app.raci_data:
            return Response(json.dumps({'error': 'No data'}), status=400, mimetype='application/json')
        cat_name = body.get('category')
        cap_name = body.get('capability')
        field = body.get('field')
        value = body.get('value')
        if field not in ('now', 'tgt') or not isinstance(value, int) or value < 0 or value > 5:
            return Response(json.dumps({'error': 'Invalid field or value'}), status=400, mimetype='application/json')
        for cat in app.raci_data['categories']:
            if cat['name'] == cat_name:
                for item in cat['items']:
                    if item['name'] == cap_name:
                        item[field] = value
                        app.raci_data['meta']['has_maturity'] = True
                        return Response(json.dumps({'ok': True}), mimetype='application/json')
        return Response(json.dumps({'error': 'Not found'}), status=404, mimetype='application/json')

    return app


def run_server(data, host='127.0.0.1', port=8080):
    app = create_app(initial_data=data)
    app.run(host=host, port=port, debug=False)
