# RACI Dashboard

A CLI tool and interactive web dashboard that turns any RACI spreadsheet into four rich visualizations: **Responsibility Heatmap**, **Ownership Sunburst**, **Workload Balance**, and **Role-to-Category Connection Map**.

Runs entirely in Docker. No local Python or Node.js required.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Running the Dashboard](#running-the-dashboard)
- [CLI Reference](#cli-reference)
- [Supported Spreadsheet Formats](#supported-spreadsheet-formats)
- [Web Dashboard Views](#web-dashboard-views)
- [Exporting](#exporting)
- [Power BI Setup Guide](#power-bi-setup-guide)
  - [Step 1: Export the Data](#step-1-export-the-data)
  - [Step 2: Import CSVs into Power BI](#step-2-import-csvs-into-power-bi)
  - [Step 3: Create Relationships](#step-3-create-relationships)
  - [Step 4: Build Visuals](#step-4-build-visuals)
  - [Step 5: Add DAX Measures](#step-5-add-dax-measures)
  - [Step 6: Apply Theme Colors](#step-6-apply-theme-colors)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Place your RACI spreadsheet in the data/ folder
cp your_raci_file.xlsx raci-dashboard/data/input.xlsx

# 2. Build and launch
cd raci-dashboard
docker compose up

# 3. Open in browser
#    http://localhost:8080
```

---

## Prerequisites

- **Docker Desktop** (Windows, macOS, or Linux)
- A RACI spreadsheet in `.xlsx` or `.csv` format

That's it. Everything else runs inside the container.

---

## Project Structure

```
raci-dashboard/
  cli.py              # CLI entry point
  parser.py           # Flexible RACI spreadsheet parser
  server.py           # Flask web server
  export.py           # HTML + Power BI export modules
  requirements.txt    # Python dependencies (openpyxl, flask)
  Dockerfile          # Container definition
  docker-compose.yml  # Docker Compose config
  web/
    index.html        # Dashboard shell
    app.jsx           # React application (4 visualization views)
    styles.css         # Dark-theme design system
  data/               # Your spreadsheet files go here (git-ignored)
    input.xlsx        # Default input file
```

---

## Running the Dashboard

### Option A: Docker Compose (recommended)

The simplest way. Reads `data/input.xlsx` by default.

```bash
cd raci-dashboard

# Build and start (first time)
docker compose up --build

# Subsequent runs
docker compose up

# Run in background
docker compose up -d

# Stop
docker compose down
```

Open **http://localhost:8080** in your browser.

To use a different file, either:
- Rename your file to `data/input.xlsx`, or
- Edit `docker-compose.yml` and change the `command:` line:
  ```yaml
  command: ["/data/my_other_file.xlsx"]
  ```

### Option B: Docker run (one-off commands)

```bash
# Build the image
docker build -t raci-dashboard .

# Launch dashboard
docker run -p 8080:8080 -v ./data:/data -e HOST=0.0.0.0 raci-dashboard /data/input.xlsx

# Export HTML (no server)
docker run -v ./data:/data raci-dashboard /data/input.xlsx --export /data/dashboard.html

# Export Power BI starter kit
docker run -v ./data:/data raci-dashboard /data/input.xlsx --powerbi /data/powerbi_export
```

### Option C: Local Python (if available)

```bash
pip install -r requirements.txt
python cli.py data/input.xlsx
```

---

## CLI Reference

```
python cli.py <file> [options]
```

| Flag | Description |
|------|-------------|
| `<file>` | Path to `.xlsx` or `.csv` RACI spreadsheet |
| `--sheet`, `-s` | Excel sheet name (default: auto-detects best RACI sheet) |
| `--export`, `-e` | Export self-contained HTML dashboard to file |
| `--json`, `-j` | Export parsed data as JSON |
| `--powerbi` | Export Power BI starter kit to directory |
| `--port`, `-p` | Server port (default: 8080) |
| `--host` | Server host (default: 127.0.0.1) |

**Examples using Docker Compose:**

```bash
# Launch interactive dashboard
docker compose up

# Export self-contained HTML file
docker compose run --rm raci-dashboard /data/input.xlsx --export /data/dashboard.html

# Export JSON data
docker compose run --rm raci-dashboard /data/input.xlsx --json /data/output.json

# Export Power BI starter kit
docker compose run --rm raci-dashboard /data/input.xlsx --powerbi /data/powerbi_export

# Specify a particular sheet
docker compose run --rm raci-dashboard /data/input.xlsx --sheet "RACI Matrix"

# Combine exports
docker compose run --rm raci-dashboard /data/input.xlsx \
  --json /data/output.json \
  --powerbi /data/powerbi_export \
  --export /data/dashboard.html
```

---

## Supported Spreadsheet Formats

The parser is designed to handle a wide variety of RACI spreadsheet layouts without manual configuration.

### File types
- `.xlsx` (Excel 2007+)
- `.xls` (legacy Excel)
- `.csv` (auto-detects delimiter and encoding)

### RACI value formats
| Format | Example | How it's handled |
|--------|---------|-----------------|
| Standard letters | `R`, `A`, `C`, `I` | Recognized directly |
| Extended variants | `S`, `D`, `V`, `P`, `X`, `L`, `O` | Mapped to R/A/C/I (RASCI, DACI, RAPID) |
| Full words | `Responsible`, `Accountable` | Matched case-insensitively |
| Multi-value | `R/A`, `R,A`, `R & A` | Keeps highest responsibility |
| Marks | `X`, `Y`, `Yes` | Treated as Responsible |

### Layout flexibility
- **Inline categories** — category name as a row with empty RACI columns
- **Explicit category column** — a dedicated "Category" / "Domain" / "Area" column
- **Merged title rows** — banner/title rows are automatically skipped
- **Sub-header rows** — full role names below abbreviated headers are detected
- **Summary/footer sections** — average rows, count rows, and RACI legends are filtered out
- **Numbered categories** — leading numbers/bullets like "1. Strategy" are stripped
- **Multiple sheets** — auto-selects the sheet with the most RACI content
- **Transposed layouts** — roles as rows, capabilities as columns
- **Maturity scales** — 0-5, 0-10, and 0-100% scales (auto-normalized to 0-5)
- **ID/priority/status columns** — automatically ignored

### Minimum requirements
Your spreadsheet needs at minimum:
1. A **header row** with column names
2. At least **2 role columns** containing R/A/C/I values
3. A **name column** for capabilities/tasks

---

## Web Dashboard Views

The dashboard has four tabs, switchable via the navigation bar or keyboard shortcuts.

### 1. Responsibility Heatmap
A color-coded matrix of all capabilities vs. roles. Each cell shows the RACI assignment with color coding:
- **R** (Responsible) = green
- **A** (Accountable) = red
- **C** (Consulted) = blue
- **I** (Informed) = gray

Includes maturity mini-bars on each row (if maturity data is present), a search/filter bar, and hover tooltips with descriptions.

### 2. Ownership Sunburst
An interactive radial chart showing the hierarchy: **Categories > Capabilities > Role assignments**. Click segments to zoom in. The detail panel shows capability descriptions, maturity scores, and assignment breakdowns.

### 3. Workload Balance
Horizontal stacked bars showing how many R/A/C/I assignments each role has. Sort by:
- Default order
- Weighted load (R=4, A=3, C=2, I=1)
- R-count (most responsible first)
- Total assignments

Unfilled/open roles are flagged with an OPEN badge.

### 4. Connection Map
Curved connection lines between roles (left) and categories (right), colored by RACI type. Toggle C/I connections on or off to focus on primary responsibility chains.

### File Upload
You can also upload a new spreadsheet directly in the browser without restarting the server. Click the upload area on the welcome screen or drag-and-drop a file.

---

## Exporting

### Self-contained HTML
Produces a single `.html` file with all CSS, JavaScript, and data embedded inline. Works completely offline — just open it in any browser.

```bash
docker compose run --rm raci-dashboard /data/input.xlsx --export /data/dashboard.html
```

The exported file is typically ~70-100KB depending on data size.

### JSON
Exports the parsed data structure for use in other tools or scripts.

```bash
docker compose run --rm raci-dashboard /data/input.xlsx --json /data/output.json
```

### Power BI Starter Kit
Exports everything you need to build the same visualizations in Power BI. See the detailed guide below.

```bash
docker compose run --rm raci-dashboard /data/input.xlsx --powerbi /data/powerbi_export
```

---

## Power BI Setup Guide

This section walks through building a full RACI dashboard in Power BI Desktop using the exported starter kit.

### Step 1: Export the Data

Run the Power BI export:

```bash
docker compose run --rm raci-dashboard /data/input.xlsx --powerbi /data/powerbi_export
```

This creates a folder with 6 files:

| File | Purpose |
|------|---------|
| `Roles.csv` | Dimension table — one row per role |
| `Capabilities.csv` | Dimension table — capabilities with maturity scores |
| `RACI_Assignments.csv` | Fact table — one row per role-capability assignment |
| `PowerQuery_Import.m` | Power Query M script for automated import |
| `DAX_Measures.dax` | Pre-built DAX measures for KPIs and formatting |
| `PowerBI_QuickStart.txt` | Condensed reference guide |

The CSVs use a **star schema**:

```
Roles[RoleID]  1 ──* RACI_Assignments[RoleID]
Capabilities[CapabilityID]  1 ──* RACI_Assignments[CapabilityID]
```

### Step 2: Import CSVs into Power BI

**Fastest method (manual import):**

1. Open **Power BI Desktop**
2. **Home > Get Data > Text/CSV**
3. Select `Roles.csv` > click **Load**
4. Repeat for `Capabilities.csv`
5. Repeat for `RACI_Assignments.csv`

**Alternative method (Power Query script):**

1. **Home > Transform Data** (opens Power Query Editor)
2. **Home > Advanced Editor**
3. Paste the entire contents of `PowerQuery_Import.m`
4. **Update the `FolderPath` variable** on line 2 to point to your export folder:
   ```
   FolderPath = "C:\Users\you\path\to\powerbi_export\"
   ```
5. Click **Done > Close & Apply**
6. Create two more queries (right-click > New Query > Blank Query) for Roles and Capabilities using the templates in the comments at the bottom of the script

### Step 3: Create Relationships

1. Go to **Model View** (left sidebar)
2. Drag `Roles[RoleID]` onto `RACI_Assignments[RoleID]` to create a relationship
3. Drag `Capabilities[CapabilityID]` onto `RACI_Assignments[CapabilityID]`
4. Both should be **One-to-Many** with a **Single** cross-filter direction

The model should look like:

```
    ┌─────────────┐         ┌─────────────────────┐
    │   Roles     │         │   Capabilities      │
    │─────────────│         │─────────────────────│
    │ RoleID (PK) │──┐   ┌──│ CapabilityID (PK)   │
    │ RoleLabel   │  │   │  │ Category            │
    │ RoleShort   │  │   │  │ Capability          │
    │ RoleColor   │  │   │  │ MaturityNow         │
    │ Status      │  │   │  │ MaturityTarget      │
    └─────────────┘  │   │  └─────────────────────┘
                     │   │
               ┌─────┴───┴──────────────┐
               │  RACI_Assignments      │
               │────────────────────────│
               │ RoleID (FK)            │
               │ CapabilityID (FK)      │
               │ RACI                   │
               │ Weight                 │
               │ IsResponsible          │
               │ IsAccountable          │
               └────────────────────────┘
```

### Step 4: Build Visuals

Switch to **Report View** and add these visuals:

#### 4a. Responsibility Heatmap (Matrix)

This is the core RACI matrix view.

1. Insert a **Matrix** visual
2. Configure fields:
   - **Rows:** `Capabilities[Category]`, then `Capabilities[Capability]`
   - **Columns:** `Roles[RoleShort]`
   - **Values:** `RACI_Assignments[RACI]` (set aggregation to **First**)
3. Add conditional formatting:
   - Select the visual > **Format > Cell elements > Background color**
   - Choose **Rules** and add:

   | If value | Then color |
   |----------|------------|
   | `is` R | `#4ae0b0` (green) |
   | `is` A | `#e06060` (red) |
   | `is` C | `#6090e0` (blue) |
   | `is` I | `#404858` (dark gray) |

4. For text color, add the same rules but use white (`#ffffff`) for all values

#### 4b. Workload Balance (Stacked Bar Chart)

Shows assignment distribution per role.

1. Insert a **Stacked Bar Chart**
2. Configure:
   - **Y-axis:** `Roles[RoleLabel]`
   - **X-axis:** Count of `RACI_Assignments[RACI]`
   - **Legend:** `RACI_Assignments[RACI]`
3. Set colors in **Format > Data colors**:
   - R = `#4ae0b0`
   - A = `#e06060`
   - C = `#6090e0`
   - I = `#404858`

#### 4c. Ownership Treemap

Shows responsibility distribution across categories.

1. Insert a **Treemap** visual
2. Configure:
   - **Group:** `Capabilities[Category]`
   - **Details:** `Capabilities[Capability]`
   - **Values:** Count of `RACI_Assignments[RACI]`
3. Add a visual-level filter: `RACI_Assignments[RACI]` equals `R`

#### 4d. Maturity Gap Chart (Clustered Bar)

Compares current vs. target maturity by category. Only shows if your data has maturity columns.

1. Insert a **Clustered Bar Chart**
2. Configure:
   - **Y-axis:** `Capabilities[Category]`
   - **X-axis:** Average of `Capabilities[MaturityNow]`, Average of `Capabilities[MaturityTarget]`
3. Set colors:
   - MaturityNow = `#d0a030` (amber)
   - MaturityTarget = `#40b060` (green)

#### 4e. Maturity Detail Table

1. Insert a **Table** visual
2. Add columns: `Category`, `Capability`, `MaturityNow`, `MaturityTarget`, `MaturityDelta`
3. Add conditional formatting on `MaturityDelta`:
   - **Format > Cell elements > Data bars** or **Background color > Gradient**
   - Low = `#c05050` (red), High = `#40b060` (green)

#### 4f. KPI Cards

Add **Card** visuals for headline metrics (use the DAX measures from Step 5):
- Total Capabilities
- Orphaned Capabilities
- Coverage %
- Maturity Gap
- Total Assignments

### Step 5: Add DAX Measures

Open `DAX_Measures.dax` from the export folder. For each measure:

1. Go to **Report View**
2. Select a table in the **Fields** pane (use RACI_Assignments for most)
3. **Home > New Measure**
4. Paste the measure and press Enter

**Tip:** Create a dedicated measures table first:
- **Home > Enter Data > create empty table named "Measures" > Load**
- Select the "Measures" table before adding each measure

Here are the key measures included:

**Assignment Counts:**
```dax
Total Assignments = COUNTROWS(RACI_Assignments)
R Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "R")
A Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "A")
C Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "C")
I Count = CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "I")
```

**Workload:**
```dax
Weighted Load = SUM(RACI_Assignments[Weight])
Avg Load Per Role = DIVIDE(COUNTROWS(RACI_Assignments), DISTINCTCOUNT(RACI_Assignments[RoleID]))
```

**Maturity:**
```dax
Avg Maturity Now = AVERAGE(Capabilities[MaturityNow])
Avg Maturity Target = AVERAGE(Capabilities[MaturityTarget])
Maturity Gap = [Avg Maturity Target] - [Avg Maturity Now]
```

**Coverage & Health:**
```dax
Orphaned Capabilities =
    COUNTROWS(
        FILTER(Capabilities,
            ISBLANK(
                CALCULATE(COUNTROWS(RACI_Assignments), RACI_Assignments[RACI] = "R")
            )
        )
    )

Coverage % = DIVIDE([Total Capabilities] - [Orphaned Capabilities], [Total Capabilities])
```

**Conditional Formatting Helpers:**
```dax
RACI Color =
    SWITCH(
        SELECTEDVALUE(RACI_Assignments[RACI]),
        "R", "#4ae0b0",
        "A", "#e06060",
        "C", "#6090e0",
        "I", "#404858",
        "#808080"
    )
```

The DAX file also includes **per-role measures** generated from your actual role names (e.g., `MGR Total`, `MGR R Count`, `HUNT Weighted`).

### Step 6: Apply Theme Colors

To match the web dashboard's dark theme:

1. **View > Themes > Customize current theme**
2. Set:
   - Page background: `#080c12`
   - Card/visual background: `#101820`
   - Text: `#c0c8d8`
   - Primary accent: `#4ae0b0`

**RACI color reference:**

| Assignment | Color | Hex |
|------------|-------|-----|
| Responsible | Green | `#4ae0b0` |
| Accountable | Red | `#e06060` |
| Consulted | Blue | `#6090e0` |
| Informed | Gray | `#404858` |

**Maturity color scale (0-5):**

| Level | Color | Hex |
|-------|-------|-----|
| 0 | Dark | `#303840` |
| 1 | Red | `#c05050` |
| 2 | Amber | `#d0a030` |
| 3 | Yellow-green | `#90c040` |
| 4 | Green | `#40b060` |
| 5 | Teal | `#30a0a0` |

---

## Keyboard Shortcuts

These work in the web dashboard:

| Key | Action |
|-----|--------|
| `1` | Switch to Heatmap |
| `2` | Switch to Sunburst |
| `3` | Switch to Workload |
| `4` | Switch to Connections |
| `/` | Focus search box |

---

## Troubleshooting

### "No RACI columns detected"
The parser couldn't find columns where >30% of values are R, A, C, or I. Check that:
- Your RACI data uses recognized values (see [Supported Spreadsheet Formats](#supported-spreadsheet-formats))
- The header row is within the first 25 rows
- Role columns have at least a few cells filled with RACI letters

### Wrong sheet is selected
Use the `--sheet` flag to specify:
```bash
docker compose run --rm raci-dashboard /data/input.xlsx --sheet "My RACI Sheet"
```

### Categories or capabilities missing
- Summary/footer rows (averages, totals, legends) are automatically filtered
- Categories where zero items have RACI assignments are excluded
- Check the column classifications in the CLI output to verify detection

### Maturity data not appearing
The parser looks for numeric columns (0-5, 0-10, or 0-100%) with headers containing keywords like "now", "current", "target", "goal". If your headers use different labels, the parser may classify them as unknown.

### Port already in use
```bash
# Use a different port
docker compose run --rm -p 9090:9090 -e PORT=9090 raci-dashboard /data/input.xlsx
```

### Docker path issues on Git Bash (Windows)
If paths get mangled (e.g., `/data/` becomes `C:/Program Files/Git/data/`), prefix commands with:
```bash
MSYS_NO_PATHCONV=1 docker compose run --rm raci-dashboard /data/input.xlsx --powerbi /data/powerbi_export
```
