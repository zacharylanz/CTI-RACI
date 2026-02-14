#!/usr/bin/env python3
"""
RACI Dashboard CLI — parse any RACI spreadsheet and launch an interactive dashboard.

Usage:
    python cli.py my_raci.xlsx                     # Launch dashboard
    python cli.py my_raci.xlsx --sheet "Sheet1"    # Specify sheet
    python cli.py my_raci.xlsx --export out.html   # Export self-contained HTML
    python cli.py my_raci.xlsx --json output.json  # Export parsed JSON
"""

import argparse
import json
import os
import sys

from parser import parse_file


def main():
    ap = argparse.ArgumentParser(
        description='RACI Dashboard — interactive visualization for RACI spreadsheets'
    )
    ap.add_argument(
        'file',
        nargs='?',
        help='Path to .xlsx or .csv RACI spreadsheet'
    )
    ap.add_argument(
        '--sheet', '-s',
        default=None,
        help='Excel sheet name (default: active sheet)'
    )
    ap.add_argument(
        '--export', '-e',
        default=None,
        metavar='OUTPUT.html',
        help='Export self-contained HTML dashboard'
    )
    ap.add_argument(
        '--json', '-j',
        default=None,
        metavar='OUTPUT.json',
        help='Export parsed data as JSON'
    )
    ap.add_argument(
        '--powerbi',
        default=None,
        metavar='OUTPUT_DIR',
        help='Export Power BI starter kit (CSVs + Power Query + DAX measures)'
    )
    ap.add_argument(
        '--port', '-p',
        type=int,
        default=int(os.environ.get('PORT', 8080)),
        help='Server port (default: 8080)'
    )
    ap.add_argument(
        '--host',
        default=os.environ.get('HOST', '127.0.0.1'),
        help='Server host (default: 127.0.0.1)'
    )

    args = ap.parse_args()

    if not args.file:
        ap.print_help()
        sys.exit(0)

    filepath = args.file
    if not os.path.exists(filepath):
        print(f"Error: File not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    # Parse the file
    print(f"Parsing: {filepath}")
    try:
        data = parse_file(filepath, args.sheet)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)

    # Print validation report
    meta = data['meta']
    print(f"\n  Sheet:        {meta['sheet']}")
    print(f"  Roles:        {meta['role_count']}")
    print(f"  Categories:   {meta['category_count']}")
    print(f"  Capabilities: {meta['capability_count']}")
    if meta.get('has_maturity'):
        print(f"  Maturity:     detected")
    if meta.get('orphaned_capabilities'):
        print(f"\n  Warning: {len(meta['orphaned_capabilities'])} capabilities with no R assigned:")
        for cap in meta['orphaned_capabilities'][:10]:
            print(f"    - {cap}")
        if len(meta['orphaned_capabilities']) > 10:
            print(f"    ... and {len(meta['orphaned_capabilities']) - 10} more")
    if meta.get('zero_r_roles'):
        print(f"\n  Warning: Roles with zero R assignments: {', '.join(meta['zero_r_roles'])}")

    print("\n  Column classifications:")
    for ci, info in sorted(meta.get('column_classifications', {}).items()):
        print(f"    Col {ci}: {info['header']!r:30s} → {info['classification']}")

    # JSON export
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"\n  JSON exported to: {args.json}")
        if not args.export:
            return

    # Power BI export
    if args.powerbi:
        from export import export_powerbi
        files = export_powerbi(data, args.powerbi)
        print(f"\n  Power BI starter kit exported to: {args.powerbi}/")
        for fp in files:
            print(f"    - {os.path.basename(fp)}")
        if not args.export:
            return

    # HTML export
    if args.export:
        from export import export_html
        export_html(data, args.export)
        print(f"\n  HTML dashboard exported to: {args.export}")
        return

    # Launch server
    from server import run_server
    print(f"\n  Starting dashboard at http://{args.host}:{args.port}")
    print("  Press Ctrl+C to stop\n")
    run_server(data, host=args.host, port=args.port)


if __name__ == '__main__':
    main()
