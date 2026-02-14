"""
Export modules: self-contained HTML dashboard and Power BI CSV tables + automation scripts.
"""

import csv
import json
import os


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, 'web')


def export_html(data, output_path):
    """Generate a single self-contained HTML file with the dashboard."""
    # Read web assets
    with open(os.path.join(WEB_DIR, 'index.html'), 'r', encoding='utf-8') as f:
        html = f.read()
    with open(os.path.join(WEB_DIR, 'app.jsx'), 'r', encoding='utf-8') as f:
        app_jsx = f.read()
    with open(os.path.join(WEB_DIR, 'styles.css'), 'r', encoding='utf-8') as f:
        styles_css = f.read()

    # Embed data as JSON
    data_json = json.dumps(data, ensure_ascii=False)
    data_script = f'<script>window.__RACI_DATA__ = {data_json};</script>'

    # Inline the CSS
    css_inline = f'<style>{styles_css}</style>'

    # Inline the JSX (loaded via Babel standalone)
    jsx_inline = f'<script type="text/babel">{app_jsx}</script>'

    # Replace external references with inline content
    # Remove the external CSS link
    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        css_inline
    )
    # Remove the external JSX script and replace with inline
    html = html.replace(
        '<script type="text/babel" src="app.jsx"></script>',
        jsx_inline
    )
    # Insert data script before closing </head>
    html = html.replace(
        '</head>',
        f'{data_script}\n</head>'
    )
    # Mark as exported (switches from fetch to embedded data)
    html = html.replace(
        '<body>',
        '<body data-exported="true">'
    )

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)


def export_powerbi(data, output_dir):
    """
    Export a complete Power BI starter kit.

    Creates:
      - Roles.csv              — dimension table (1 row per role)
      - Capabilities.csv       — dimension + maturity facts
      - RACI_Assignments.csv   — fact table (1 row per role-capability pair)
      - PowerQuery_Import.m    — paste into Power BI Advanced Editor to auto-import all 3 CSVs
      - DAX_Measures.dax       — ready-to-paste DAX measures for common KPIs
      - PowerBI_QuickStart.txt — step-by-step instructions

    Power BI model:
      Roles[RoleID] 1──* RACI_Assignments[RoleID]
      Capabilities[CapabilityID] 1──* RACI_Assignments[CapabilityID]
    """
    os.makedirs(output_dir, exist_ok=True)
    roles = data['roles']
    categories = data['categories']

    # ── Roles.csv ──
    roles_path = os.path.join(output_dir, 'Roles.csv')
    with open(roles_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['RoleID', 'RoleLabel', 'RoleShort', 'RoleColor', 'Status'])
        for r in roles:
            w.writerow([r['id'], r['label'], r['short'], r['color'], r['status']])

    # ── Capabilities.csv ──
    cap_path = os.path.join(output_dir, 'Capabilities.csv')
    cap_id = 0
    cap_lookup = {}  # (category, name) -> id
    with open(cap_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow([
            'CapabilityID', 'Category', 'CategoryColor', 'Capability',
            'Description', 'MaturityNow', 'MaturityTarget', 'MaturityDelta',
        ])
        for cat in categories:
            for item in cat['items']:
                cap_id += 1
                cap_lookup[(cat['name'], item['name'])] = cap_id
                now = item.get('now', '')
                tgt = item.get('tgt', '')
                delta = ''
                if isinstance(now, (int, float)) and isinstance(tgt, (int, float)):
                    delta = tgt - now
                w.writerow([
                    cap_id, cat['name'], cat['color'], item['name'],
                    item.get('desc', ''), now, tgt, delta,
                ])

    # ── RACI_Assignments.csv ──
    raci_path = os.path.join(output_dir, 'RACI_Assignments.csv')
    raci_weights = {'R': 4, 'A': 3, 'C': 2, 'I': 1}
    with open(raci_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow([
            'CapabilityID', 'RoleID', 'Category', 'Capability',
            'RoleLabel', 'RACI', 'Weight', 'IsResponsible', 'IsAccountable',
        ])
        for cat in categories:
            for item in cat['items']:
                cid = cap_lookup[(cat['name'], item['name'])]
                for r in roles:
                    val = item.get(r['id'])
                    if val:
                        w.writerow([
                            cid, r['id'], cat['name'], item['name'],
                            r['label'], val, raci_weights.get(val, 0),
                            1 if val == 'R' else 0,
                            1 if val == 'A' else 0,
                        ])

    # ── Power Query M script ──
    pq_path = os.path.join(output_dir, 'PowerQuery_Import.m')
    with open(pq_path, 'w', encoding='utf-8') as f:
        f.write(_generate_power_query_script())

    # ── DAX measures ──
    dax_path = os.path.join(output_dir, 'DAX_Measures.dax')
    with open(dax_path, 'w', encoding='utf-8') as f:
        f.write(_generate_dax_measures(roles))

    # ── Quick-start instructions ──
    readme_path = os.path.join(output_dir, 'PowerBI_QuickStart.txt')
    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write(POWERBI_QUICKSTART)

    return [roles_path, cap_path, raci_path, pq_path, dax_path, readme_path]


def _generate_power_query_script():
    """Generate Power Query M script that auto-imports all 3 CSVs from the same folder."""
    return r'''// ============================================================
// RACI Dashboard — Power Query Auto-Import Script
// ============================================================
//
// HOW TO USE:
//   1. Open Power BI Desktop
//   2. Home > Transform Data > Advanced Editor
//   3. Paste this ENTIRE script, replacing the default query
//   4. Click "Done"
//   5. In the "Applied Steps" pane you'll see Roles, Capabilities,
//      and RACI_Assignments tables loaded
//
// IMPORTANT: Update the FolderPath below to point to the folder
//            containing your CSV files.
// ============================================================

let
    // *** CHANGE THIS PATH to where you saved the CSV files ***
    FolderPath = "C:\RACI_PowerBI\",

    // ── Load Roles ──
    Roles_Raw = Csv.Document(
        File.Contents(FolderPath & "Roles.csv"),
        [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]
    ),
    Roles_Headers = Table.PromoteHeaders(Roles_Raw, [PromoteAllScalars=true]),
    Roles = Table.TransformColumnTypes(Roles_Headers, {
        {"RoleID", type text},
        {"RoleLabel", type text},
        {"RoleShort", type text},
        {"RoleColor", type text},
        {"Status", type text}
    }),

    // ── Load Capabilities ──
    Capabilities_Raw = Csv.Document(
        File.Contents(FolderPath & "Capabilities.csv"),
        [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]
    ),
    Capabilities_Headers = Table.PromoteHeaders(Capabilities_Raw, [PromoteAllScalars=true]),
    Capabilities = Table.TransformColumnTypes(Capabilities_Headers, {
        {"CapabilityID", Int64.Type},
        {"Category", type text},
        {"CategoryColor", type text},
        {"Capability", type text},
        {"Description", type text},
        {"MaturityNow", type number},
        {"MaturityTarget", type number},
        {"MaturityDelta", type number}
    }),

    // ── Load RACI Assignments ──
    RACI_Raw = Csv.Document(
        File.Contents(FolderPath & "RACI_Assignments.csv"),
        [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]
    ),
    RACI_Headers = Table.PromoteHeaders(RACI_Raw, [PromoteAllScalars=true]),
    RACI_Assignments = Table.TransformColumnTypes(RACI_Headers, {
        {"CapabilityID", Int64.Type},
        {"RoleID", type text},
        {"Category", type text},
        {"Capability", type text},
        {"RoleLabel", type text},
        {"RACI", type text},
        {"Weight", Int64.Type},
        {"IsResponsible", Int64.Type},
        {"IsAccountable", Int64.Type}
    })
in
    RACI_Assignments

// ============================================================
// AFTER IMPORT: Create separate queries
// ============================================================
// The script above loads RACI_Assignments as the main query.
// To also get Roles and Capabilities as separate tables:
//
//   1. Right-click in the Queries pane > "New Query" > "Blank Query"
//   2. Open Advanced Editor and paste JUST this for Roles:
//
//        let
//            FolderPath = "C:\RACI_PowerBI\",
//            Source = Csv.Document(File.Contents(FolderPath & "Roles.csv"),
//                [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),
//            Headers = Table.PromoteHeaders(Source, [PromoteAllScalars=true])
//        in
//            Headers
//
//   3. Repeat for Capabilities (change filename to "Capabilities.csv")
//
// ALTERNATIVELY (easier): Just use Get Data > Text/CSV three times,
//   one for each CSV file. The Power Query script above is optional.
// ============================================================
'''


def _generate_dax_measures(roles):
    """Generate ready-to-paste DAX measures for common RACI KPIs."""
    lines = [
        '// ============================================================',
        '// RACI Dashboard — DAX Measures',
        '// ============================================================',
        '//',
        '// HOW TO USE:',
        '//   1. In Power BI Desktop, go to the Model view',
        '//   2. Select RACI_Assignments table',
        '//   3. Click "New Measure" in the ribbon',
        '//   4. Paste each measure below one at a time',
        '//',
        '// TIP: You can also paste these into a "Measures" table',
        '//      (Home > Enter Data > create empty table named "Measures")',
        '// ============================================================',
        '',
        '',
        '// ── ASSIGNMENT COUNTS ──',
        '',
        'Total Assignments = COUNTROWS(RACI_Assignments)',
        '',
        'R Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "R")',
        '',
        'A Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "A")',
        '',
        'C Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "C")',
        '',
        'I Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "I")',
        '',
        '',
        '// ── WORKLOAD ──',
        '',
        'Weighted Load = SUM(RACI_Assignments[Weight])',
        '',
        'Avg Load Per Role = ',
        '    DIVIDE(',
        '        COUNTROWS(RACI_Assignments),',
        '        DISTINCTCOUNT(RACI_Assignments[RoleID])',
        '    )',
        '',
        '',
        '// ── MATURITY ──',
        '',
        'Avg Maturity Now = AVERAGE(Capabilities[MaturityNow])',
        '',
        'Avg Maturity Target = AVERAGE(Capabilities[MaturityTarget])',
        '',
        'Maturity Gap = [Avg Maturity Target] - [Avg Maturity Now]',
        '',
        'Maturity Gap % = ',
        '    DIVIDE(',
        '        [Avg Maturity Target] - [Avg Maturity Now],',
        '        [Avg Maturity Target]',
        '    )',
        '',
        '',
        '// ── COVERAGE & HEALTH ──',
        '',
        'Total Capabilities = COUNTROWS(Capabilities)',
        '',
        'Orphaned Capabilities = ',
        '    COUNTROWS(',
        '        FILTER(',
        '            Capabilities,',
        '            ISBLANK(',
        '                CALCULATE(',
        '                    COUNTROWS(RACI_Assignments),',
        '                    RACI_Assignments[RACI] = "R"',
        '                )',
        '            )',
        '        )',
        '    )',
        '',
        'Coverage % = ',
        '    DIVIDE(',
        '        [Total Capabilities] - [Orphaned Capabilities],',
        '        [Total Capabilities]',
        '    )',
        '',
        'Dual-R Capabilities = ',
        '    // Capabilities with >1 person marked R (potential conflict)',
        '    COUNTROWS(',
        '        FILTER(',
        '            Capabilities,',
        '            CALCULATE(',
        '                COUNTROWS(RACI_Assignments),',
        '                RACI_Assignments[RACI] = "R"',
        '            ) > 1',
        '        )',
        '    )',
        '',
        'No-A Capabilities = ',
        '    // Capabilities with no Accountable person assigned',
        '    COUNTROWS(',
        '        FILTER(',
        '            Capabilities,',
        '            ISBLANK(',
        '                CALCULATE(',
        '                    COUNTROWS(RACI_Assignments),',
        '                    RACI_Assignments[RACI] = "A"',
        '                )',
        '            )',
        '        )',
        '    )',
        '',
        '',
        '// ── CONDITIONAL FORMATTING COLORS ──',
        '// Use these in conditional formatting rules for visuals:',
        '//',
        '// RACI cell colors:',
        '//   R = #4ae0b0 (green)   A = #e06060 (red)',
        '//   C = #6090e0 (blue)    I = #404858 (gray)',
        '//',
        '// Maturity colors (0-5):',
        '//   0 = #303840   1 = #c05050   2 = #d0a030',
        '//   3 = #90c040   4 = #40b060   5 = #30a0a0',
        '',
        'RACI Color = ',
        '    SWITCH(',
        '        SELECTEDVALUE(RACI_Assignments[RACI]),',
        '        "R", "#4ae0b0",',
        '        "A", "#e06060",',
        '        "C", "#6090e0",',
        '        "I", "#404858",',
        '        "#808080"',
        '    )',
        '',
        'Maturity Color = ',
        '    VAR MaturityVal = SELECTEDVALUE(Capabilities[MaturityNow])',
        '    RETURN',
        '    SWITCH(',
        '        TRUE(),',
        '        MaturityVal = 0, "#303840",',
        '        MaturityVal = 1, "#c05050",',
        '        MaturityVal = 2, "#d0a030",',
        '        MaturityVal = 3, "#90c040",',
        '        MaturityVal = 4, "#40b060",',
        '        MaturityVal >= 5, "#30a0a0",',
        '        "#808080"',
        '    )',
    ]

    # Add role-specific measures
    lines.append('')
    lines.append('')
    lines.append('// ── PER-ROLE MEASURES ──')
    for role in roles:
        rid = role['id']
        label = role['label']
        short = role['short']
        lines.append('')
        lines.append(f'// {label} ({short})')
        lines.append(f'{short} Total = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RoleID] = "{rid}")')
        lines.append(f'{short} R Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RoleID] = "{rid}", RACI_Assignments[RACI] = "R")')
        lines.append(f'{short} Weighted = CALCULATE(SUM(RACI_Assignments[Weight]), RACI_Assignments[RoleID] = "{rid}")')

    return '\n'.join(lines) + '\n'


POWERBI_QUICKSTART = """
RACI Dashboard — Power BI Quick Start Guide
=============================================

This folder contains everything you need to build a RACI dashboard in Power BI.


FILES
-----
  Roles.csv              Role dimension table (1 row per role)
  Capabilities.csv       Capability dimension + maturity facts
  RACI_Assignments.csv   Fact table (1 row per role-capability pair)
  PowerQuery_Import.m    Power Query script for auto-import
  DAX_Measures.dax       Ready-to-paste DAX measures
  PowerBI_QuickStart.txt This file


FASTEST WAY (3 minutes)
-----------------------

  1. Open Power BI Desktop
  2. Get Data > Text/CSV > import Roles.csv
  3. Get Data > Text/CSV > import Capabilities.csv
  4. Get Data > Text/CSV > import RACI_Assignments.csv
  5. Go to Model View and create relationships:
       Roles[RoleID]          1 ──* RACI_Assignments[RoleID]
       Capabilities[CapabilityID] 1 ──* RACI_Assignments[CapabilityID]
  6. Done! Now build visuals (see below)


ALTERNATIVE: POWER QUERY SCRIPT
--------------------------------

  1. Open Power BI Desktop
  2. Home > Transform Data
  3. In Power Query Editor: Home > Advanced Editor
  4. Paste contents of PowerQuery_Import.m
  5. Update the FolderPath variable to point to this folder
  6. Click Done > Close & Apply


ADDING DAX MEASURES
-------------------

  1. Go to Report view
  2. Select the RACI_Assignments table in the Fields pane
  3. Home > New Measure
  4. Open DAX_Measures.dax and paste measures one at a time
  5. TIP: Create a "Measures" table (Enter Data > empty table)
     and add measures there to keep things organized


RECOMMENDED VISUALS
-------------------

  1. RESPONSIBILITY HEATMAP (Matrix visual)
     ─────────────────────────────────────
     Rows:     Capabilities[Category], Capabilities[Capability]
     Columns:  Roles[RoleShort]
     Values:   First of RACI_Assignments[RACI]

     Conditional formatting:
       Format > Cell elements > Background color > Rules
         If value is "R" then #4ae0b0
         If value is "A" then #e06060
         If value is "C" then #6090e0
         If value is "I" then #404858

  2. WORKLOAD BALANCE (Stacked Bar Chart)
     ────────────────────────────────────
     Y-axis:   Roles[RoleLabel]
     X-axis:   Count of RACI_Assignments[RACI]
     Legend:    RACI_Assignments[RACI]

     Colors (Format > Data colors):
       R = #4ae0b0   A = #e06060   C = #6090e0   I = #404858

  3. OWNERSHIP TREEMAP (Treemap visual)
     ──────────────────────────────────
     Group:    Capabilities[Category]
     Details:  Capabilities[Capability]
     Values:   R Count measure (or filter RACI = "R")

  4. MATURITY GAP (Clustered Bar Chart)
     ──────────────────────────────────
     Y-axis:   Capabilities[Category]
     X-axis:   Average of Capabilities[MaturityNow],
               Average of Capabilities[MaturityTarget]
     Colors:   Now = #d0a030   Target = #40b060

  5. SUNBURST (if Power BI Sunburst visual installed)
     ────────────────────────────────────────────────
     Install: Visualizations pane > ... > Get more visuals
     Search: "Sunburst"

     Group:    Capabilities[Category]
     Details:  Capabilities[Capability]
     Values:   Count of RACI_Assignments

  6. CONNECTION MAP (Decomposition Tree)
     ──────────────────────────────────
     Analyze:  Count of RACI_Assignments
     Explain by: Roles[RoleLabel], Capabilities[Category],
                 RACI_Assignments[RACI]


KPI CARDS
---------
  Add Card visuals for these measures:
    - Total Capabilities
    - Orphaned Capabilities (no R assigned)
    - Coverage %
    - Maturity Gap
    - Avg Maturity Now vs Target


THEME COLORS
------------
  To match the web dashboard dark theme:
    - Page background: #080c12
    - Card background: #101820
    - Text: #c0c8d8
    - Accent: #4ae0b0

  RACI colors:
    R = #4ae0b0   A = #e06060   C = #6090e0   I = #404858

  Maturity scale:
    0 = #303840   1 = #c05050   2 = #d0a030
    3 = #90c040   4 = #40b060   5 = #30a0a0

  Apply via: View > Themes > Customize current theme
"""
