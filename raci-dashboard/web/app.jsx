/* ═══════════════════════════════════════════════════════
   RACI Dashboard — Interactive Visualization App v2
   ═══════════════════════════════════════════════════════ */

const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } = React;

// ─── Constants ───
const RACI_COLORS = { R: '#4ae0b0', A: '#e06060', C: '#6090e0', I: '#404858' };
const RACI_LABELS = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
const RACI_WEIGHTS = { R: 4, A: 3, C: 2, I: 1 };
const MATURITY_COLORS = ['#303840', '#c05050', '#d0a030', '#90c040', '#40b060', '#30a0a0'];
const MATURITY_LABELS = ['Not Started', 'Initial', 'Developing', 'Defined', 'Managed', 'Optimizing'];
const VIEWS = [
    { id: 'Heatmap', key: '1', icon: 'grid' },
    { id: 'Sunburst', key: '2', icon: 'circle' },
    { id: 'Workload', key: '3', icon: 'bar' },
    { id: 'Connections', key: '4', icon: 'link' },
];

// ─── Tooltip Context ───
const TooltipCtx = createContext({ show: () => {}, hide: () => {} });

function TooltipProvider({ children }) {
    const [tip, setTip] = useState(null);
    const posRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const onMove = (e) => { posRef.current = { x: e.clientX, y: e.clientY }; };
        window.addEventListener('mousemove', onMove);
        return () => window.removeEventListener('mousemove', onMove);
    }, []);

    const show = useCallback((content) => {
        setTip({ content, ...posRef.current });
    }, []);
    const hide = useCallback(() => setTip(null), []);

    // Update position while visible
    useEffect(() => {
        if (!tip) return;
        const id = setInterval(() => {
            setTip(prev => prev ? { ...prev, x: posRef.current.x, y: posRef.current.y } : null);
        }, 16);
        return () => clearInterval(id);
    }, [!!tip]);

    return (
        <TooltipCtx.Provider value={{ show, hide }}>
            {children}
            {tip && (
                <div className="tooltip" style={{
                    left: Math.min(tip.x + 14, window.innerWidth - 320),
                    top: Math.min(tip.y + 14, window.innerHeight - 200),
                }}>
                    {tip.content}
                </div>
            )}
        </TooltipCtx.Provider>
    );
}

// ─── Browser-side Excel Parser (mirrors Python parser.py) ───
function parseXLSXInBrowser(workbook, sheetName) {
    const ws = sheetName ? workbook.Sheets[sheetName] : workbook.Sheets[workbook.SheetNames[0]];
    const usedSheet = sheetName || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!rows.length) throw new Error('Sheet is empty');

    const RACI_VALUES = new Set(['R', 'A', 'C', 'I']);
    const ROLE_PALETTE = ['#4ae0b0', '#e0a040', '#6090e0', '#a0b8d0', '#e06080', '#80d0d0', '#d080e0', '#c0c060'];
    const CAT_PALETTE = ['#8090CC', '#50C890', '#90C850', '#B888CC', '#C8A050', '#A080C0', '#C89850', '#6898B8', '#58A8C0'];
    const TARGET_KW = ['target', 'tgt', 'future', 'goal', 'projected', 'to-be', 'to be', 'with'];
    const UNFILLED_KW = ['open', 'unfilled', 'vacant', '\u2605', 'tbd', 'tbc', 'hire'];

    const str = v => (v == null ? '' : String(v).trim());
    const strUp = v => str(v).toUpperCase();
    const isRaci = v => RACI_VALUES.has(strUp(v));
    const isMat = v => { const s = str(v); if (!s) return false; const n = Number(s); return !isNaN(n) && n >= 0 && n <= 5; };

    let headerIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const nonEmpty = (rows[i] || []).filter(c => str(c) !== '');
        const unique = new Set(nonEmpty.map(c => str(c)));
        if (nonEmpty.length >= 4 && unique.size >= 3) { headerIdx = i; break; }
        if (nonEmpty.length >= 3 && unique.size >= 2 && headerIdx === 0) headerIdx = i;
    }

    const maxCols = Math.max(...rows.map(r => (r || []).length));
    const headers = [...(rows[headerIdx] || [])];
    while (headers.length < maxCols) headers.push(null);
    rows.forEach(r => { while (r.length < maxCols) r.push(null); });

    let skip = 0;
    const subheaderRows = [];
    for (let i = headerIdx + 1; i < Math.min(headerIdx + 5, rows.length); i++) {
        const row = rows[i];
        const nonEmpty = row.filter(c => str(c) !== '');
        if (nonEmpty.length < 3) break;
        if (row.some(c => isRaci(c)) || row.some(c => isMat(c))) break;
        subheaderRows.push(row);
        skip++;
    }

    const dataRows = rows.slice(headerIdx + 1 + skip);

    const classifications = {};
    let nameFound = false;
    for (let ci = 0; ci < maxCols; ci++) {
        const hl = str(headers[ci]).toLowerCase();
        const values = dataRows.map(r => str(r[ci])).filter(v => v !== '');
        const total = values.length;
        if (total === 0) { classifications[ci] = 'empty'; continue; }
        if (['delta', 'uplift', 'gap', '\u0394', 'diff'].some(k => hl.includes(k))) { classifications[ci] = 'delta'; continue; }
        if (hl === 'status' || hl === 'state') { classifications[ci] = 'status'; continue; }
        const raciPct = values.filter(v => RACI_VALUES.has(v.toUpperCase())).length / total;
        const matPct = values.filter(v => isMat(v)).length / total;
        const uniqueRatio = new Set(values.map(v => v.toLowerCase())).size / total;
        const avgLen = values.reduce((s, v) => s + v.length, 0) / total;
        if (raciPct > 0.4) { classifications[ci] = 'raci'; }
        else if (matPct > 0.4) {
            const isTarget = TARGET_KW.some(k => hl.includes(k));
            const hasPriorMat = Object.values(classifications).includes('maturity_now');
            classifications[ci] = (isTarget || hasPriorMat) ? 'maturity_target' : 'maturity_now';
        } else if (['desc', 'description', 'details', 'notes'].some(k => hl.includes(k))) { classifications[ci] = 'description'; }
        else if (['category', 'domain', 'area', 'group', 'pillar', 'section'].some(k => hl.includes(k))) { classifications[ci] = 'category'; }
        else if (['capability', 'name', 'activity', 'task', 'function', 'process', 'item'].some(k => hl.includes(k))) { classifications[ci] = 'name'; nameFound = true; }
        else if (!nameFound && avgLen > 3 && uniqueRatio > 0.5) {
            if (uniqueRatio < 0.3 && total > 5) classifications[ci] = 'category';
            else { classifications[ci] = 'name'; nameFound = true; }
        } else if (uniqueRatio < 0.3 && total > 3) { classifications[ci] = 'category'; }
        else { classifications[ci] = 'unknown'; }
    }
    if (!Object.values(classifications).includes('name')) {
        const first = Object.keys(classifications).find(k => ['unknown', undefined].includes(classifications[k]));
        if (first != null) classifications[first] = 'name'; else classifications[0] = 'name';
    }

    const raciCols = Object.entries(classifications).filter(([, t]) => t === 'raci').map(([ci]) => Number(ci)).sort((a, b) => a - b);
    if (!raciCols.length) throw new Error('No RACI columns detected');

    const makeId = label => label.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_').toLowerCase();
    const makeShort = label => {
        if (label.length <= 5) return label.toUpperCase();
        const cons = label.replace(/[aeiou\s\W]/gi, '');
        return cons.length >= 3 ? cons.slice(0, 4).toUpperCase() : label.slice(0, 4).toUpperCase();
    };

    // Build sub-header lookup
    const subLabels = {};
    for (const sub of subheaderRows) {
        for (const ci of raciCols) {
            const v = str(sub[ci]);
            if (v && v.length > 1) subLabels[ci] = v;
        }
    }

    const roles = raciCols.map((ci, i) => {
        const hdr = str(headers[ci]);
        const full = subLabels[ci] || hdr;
        const short = (hdr.length <= 6 && hdr === hdr.toUpperCase()) ? hdr : makeShort(hdr);
        return {
            id: makeId(full), label: full, short,
            color: ROLE_PALETTE[i % ROLE_PALETTE.length],
            status: UNFILLED_KW.some(k => full.toLowerCase().includes(k) || hdr.toLowerCase().includes(k)) ? 'unfilled' : 'filled',
            _ci: ci,
        };
    });

    const nameCol = Number(Object.keys(classifications).find(k => classifications[k] === 'name'));
    const catCol = Object.keys(classifications).find(k => classifications[k] === 'category');
    const descCol = Object.keys(classifications).find(k => classifications[k] === 'description');
    const matNowCol = Object.keys(classifications).find(k => classifications[k] === 'maturity_now');
    const matTgtCol = Object.keys(classifications).find(k => classifications[k] === 'maturity_target');

    const catsDict = {};
    let currentCat = 'General';
    for (const row of dataRows) {
        const nonEmpty = row.filter(c => str(c) !== '');
        if (!nonEmpty.length) continue;
        const nameVal = str(row[nameCol]);
        const allRaciEmpty = raciCols.every(ci => strUp(row[ci]) === '');
        if (nameVal && allRaciEmpty && catCol == null) { currentCat = nameVal; continue; }
        if (!nameVal) continue;
        if (catCol != null) { const cv = str(row[Number(catCol)]); if (cv) currentCat = cv; }
        const item = { name: nameVal };
        if (descCol != null) item.desc = str(row[Number(descCol)]);
        for (const role of roles) { const v = strUp(row[role._ci]); if (RACI_VALUES.has(v)) item[role.id] = v; }
        if (matNowCol != null) { const n = Number(str(row[Number(matNowCol)])); if (!isNaN(n)) item.now = Math.round(n); }
        if (matTgtCol != null) { const n = Number(str(row[Number(matTgtCol)])); if (!isNaN(n)) item.tgt = Math.round(n); }
        if (!catsDict[currentCat]) catsDict[currentCat] = [];
        catsDict[currentCat].push(item);
    }

    const roleIds = roles.map(r => r.id);
    const categories = Object.entries(catsDict)
        .filter(([, items]) => items.length > 0 && items.some(item => roleIds.some(rid => ['R','A','C','I'].includes(item[rid]))))
        .map(([name, items], i) => ({ name, color: CAT_PALETTE[i % CAT_PALETTE.length], items }));

    const rolesClean = roles.map(({ _ci, ...r }) => r);
    const totalCap = categories.reduce((s, c) => s + c.items.length, 0);
    const orphaned = [];
    categories.forEach(c => c.items.forEach(item => {
        if (!rolesClean.some(r => item[r.id] === 'R')) orphaned.push(`${c.name} > ${item.name}`);
    }));
    const zeroR = rolesClean.filter(r => !categories.some(c => c.items.some(item => item[r.id] === 'R'))).map(r => r.label);
    const colReport = {};
    Object.entries(classifications).filter(([, t]) => !['empty', 'delta'].includes(t))
        .forEach(([ci, t]) => { colReport[ci] = { header: str(headers[ci]), classification: t }; });

    return {
        roles: rolesClean, categories,
        meta: {
            filename: '(uploaded)', sheet: usedSheet,
            role_count: rolesClean.length, category_count: categories.length,
            capability_count: totalCap, orphaned_capabilities: orphaned,
            zero_r_roles: zeroR, has_maturity: matNowCol != null,
            column_classifications: colReport,
        },
    };
}

// ─── Computed Data ───
function useComputedData(data) {
    return useMemo(() => {
        if (!data) return null;
        const { roles, categories } = data;

        const roleCounts = {};
        roles.forEach(r => { roleCounts[r.id] = { R: 0, A: 0, C: 0, I: 0, total: 0, weighted: 0 }; });
        categories.forEach(c => c.items.forEach(item => {
            roles.forEach(r => {
                const v = item[r.id];
                if (v && RACI_WEIGHTS[v]) {
                    roleCounts[r.id][v]++;
                    roleCounts[r.id].total++;
                    roleCounts[r.id].weighted += RACI_WEIGHTS[v];
                }
            });
        }));

        const maxWeighted = Math.max(...Object.values(roleCounts).map(rc => rc.weighted), 1);

        const heatmapData = categories.map(cat => {
            const row = {};
            roles.forEach(r => {
                let w = 0, maxW = 0, rCount = 0, aCount = 0;
                cat.items.forEach(item => {
                    const v = item[r.id];
                    maxW += RACI_WEIGHTS.R;
                    if (v) { w += RACI_WEIGHTS[v]; if (v === 'R') rCount++; if (v === 'A') aCount++; }
                });
                row[r.id] = { pct: maxW > 0 ? Math.round((w / maxW) * 100) : 0, rCount, aCount };
            });
            return { category: cat.name, color: cat.color, data: row };
        });

        const connections = [];
        roles.forEach(r => {
            categories.forEach(c => {
                let rCount = 0, aCount = 0, cCount = 0, iCount = 0;
                c.items.forEach(item => {
                    const v = item[r.id];
                    if (v === 'R') rCount++; else if (v === 'A') aCount++;
                    else if (v === 'C') cCount++; else if (v === 'I') iCount++;
                });
                if (rCount > 0 || aCount > 0 || cCount > 0 || iCount > 0) {
                    connections.push({ roleId: r.id, category: c.name, rCount, aCount, cCount, iCount, weight: rCount * 4 + aCount * 3 + cCount * 2 + iCount });
                }
            });
        });

        const workloadBreakdown = {};
        roles.forEach(r => {
            workloadBreakdown[r.id] = categories.map(c => {
                let rC = 0, aC = 0, cC = 0, iC = 0;
                c.items.forEach(item => {
                    const v = item[r.id];
                    if (v === 'R') rC++; else if (v === 'A') aC++; else if (v === 'C') cC++; else if (v === 'I') iC++;
                });
                return { cat: c.name, color: c.color, R: rC, A: aC, C: cC, I: iC };
            }).filter(b => b.R + b.A + b.C + b.I > 0);
        });

        // Maturity stats per category
        const maturityStats = categories.map(c => {
            const items = c.items.filter(i => i.now != null);
            const avgNow = items.length ? items.reduce((s, i) => s + i.now, 0) / items.length : null;
            const tgtItems = c.items.filter(i => i.tgt != null);
            const avgTgt = tgtItems.length ? tgtItems.reduce((s, i) => s + i.tgt, 0) / tgtItems.length : null;
            return { name: c.name, color: c.color, avgNow, avgTgt, count: items.length };
        });

        return { roleCounts, maxWeighted, heatmapData, connections, workloadBreakdown, maturityStats };
    }, [data]);
}

// ─── RACI Legend ───
function RaciLegend() {
    return (
        <div className="raci-legend">
            {['R', 'A', 'C', 'I'].map(k => (
                <span key={k} className="legend-item">
                    <span className="legend-dot" style={{ backgroundColor: RACI_COLORS[k] }}></span>
                    <span className="legend-letter">{k}</span>
                    <span className="legend-label">{RACI_LABELS[k]}</span>
                </span>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════
// View 1: Responsibility Heatmap
// ═══════════════════════════════════════════
function HeatmapView({ data, computed, search }) {
    const { roles, categories } = data;
    const { show, hide } = useContext(TooltipCtx);
    const [hoveredCol, setHoveredCol] = useState(null);
    const [hoveredCat, setHoveredCat] = useState(null);

    const filteredCategories = useMemo(() => {
        if (!search) return categories;
        const q = search.toLowerCase();
        return categories.map(c => ({
            ...c,
            items: c.items.filter(i => i.name.toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q)),
        })).filter(c => c.items.length > 0 || c.name.toLowerCase().includes(q));
    }, [categories, search]);

    const showItemTip = (item, role) => {
        const val = item[role.id];
        show(
            <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.name}</div>
                {item.desc && <div style={{ color: '#8898a8', fontSize: 11, marginBottom: 6 }}>{item.desc}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: role.color }}>{role.label}</span>
                    <span style={{ color: val ? RACI_COLORS[val] : '#506070', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {val ? `${val} — ${RACI_LABELS[val]}` : '—'}
                    </span>
                </div>
                {(item.now != null || item.tgt != null) && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#8898a8', display: 'flex', gap: 12 }}>
                        {item.now != null && <span>Now: <b style={{ color: MATURITY_COLORS[item.now] }}>{item.now}</b></span>}
                        {item.tgt != null && <span>Target: <b style={{ color: MATURITY_COLORS[item.tgt] }}>{item.tgt}</b></span>}
                        {item.now != null && item.tgt != null && <span>Gap: <b>{item.tgt - item.now}</b></span>}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="heatmap-container">
            <table className="heatmap-table">
                <thead>
                    <tr>
                        <th style={{ textAlign: 'left', minWidth: 220 }}></th>
                        {roles.map(r => (
                            <th key={r.id}
                                onMouseEnter={() => { setHoveredCol(r.id); show(<div><b style={{ color: r.color }}>{r.label}</b><br/><span style={{ fontSize: 11, color: '#8898a8' }}>{r.status === 'unfilled' ? 'OPEN' : 'Filled'} &middot; {computed.roleCounts[r.id].R}R {computed.roleCounts[r.id].A}A {computed.roleCounts[r.id].C}C {computed.roleCounts[r.id].I}I</span></div>); }}
                                onMouseLeave={() => { setHoveredCol(null); hide(); }}
                                className={hoveredCol && hoveredCol !== r.id ? 'dimmed' : ''}
                                style={{ color: r.color }}>
                                {r.short}
                                {r.status === 'unfilled' && <span className="heatmap-unfilled-dot"></span>}
                            </th>
                        ))}
                        {data.meta.has_maturity && <th style={{ color: 'var(--text-dim)', fontSize: 10, minWidth: 80 }}>MATURITY</th>}
                    </tr>
                </thead>
                <tbody>
                    {filteredCategories.map((cat, ci) => {
                        const catData = computed.heatmapData.find(h => h.category === cat.name);
                        return (
                        <React.Fragment key={cat.name}>
                            <tr>
                                <td className="heatmap-cat-header"
                                    colSpan={roles.length + 1 + (data.meta.has_maturity ? 1 : 0)}
                                    onMouseEnter={() => setHoveredCat(cat.name)}
                                    onMouseLeave={() => setHoveredCat(null)}>
                                    <span className="heatmap-cat-dot" style={{ backgroundColor: cat.color }}></span>
                                    {cat.name}
                                    <span className="heatmap-cat-count">{cat.items.length}</span>
                                </td>
                            </tr>
                            {cat.items.map((item, ii) => {
                                const rowKey = `${cat.name}__${ii}`;
                                const isRowDimmed = hoveredCat && hoveredCat !== cat.name;
                                return (
                                    <tr key={rowKey} className={isRowDimmed ? 'dimmed' : ''}>
                                        <td className="heatmap-row-name" title={item.desc || item.name}>{item.name}</td>
                                        {roles.map(r => {
                                            const val = item[r.id];
                                            const isColDimmed = hoveredCol && hoveredCol !== r.id;
                                            return (
                                                <td key={r.id}
                                                    className={`heatmap-cell ${isColDimmed && !hoveredCat ? 'dimmed' : ''} ${val ? 'raci-' + val.toLowerCase() : 'raci-empty'}`}
                                                    onMouseEnter={() => showItemTip(item, r)}
                                                    onMouseLeave={hide}>
                                                    {val || ''}
                                                </td>
                                            );
                                        })}
                                        {data.meta.has_maturity && (
                                            <td className="heatmap-maturity-cell">
                                                {item.now != null && (
                                                    <div className="mini-maturity">
                                                        <div className="mini-mat-track">
                                                            <div className="mini-mat-fill" style={{ width: `${(item.now / 5) * 100}%`, backgroundColor: MATURITY_COLORS[item.now] }}></div>
                                                            {item.tgt != null && <div className="mini-mat-target" style={{ left: `${(item.tgt / 5) * 100}%` }}></div>}
                                                        </div>
                                                        <span className="mini-mat-label" style={{ color: MATURITY_COLORS[item.now] }}>{item.now}</span>
                                                        {item.tgt != null && <span className="mini-mat-arrow">&#8594;</span>}
                                                        {item.tgt != null && <span className="mini-mat-label" style={{ color: MATURITY_COLORS[item.tgt] }}>{item.tgt}</span>}
                                                    </div>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                        );
                    })}
                    {/* Summary row */}
                    <tr className="summary-row">
                        <td className="heatmap-cat-header summary-label">Summary</td>
                        {roles.map(r => {
                            const rc = computed.roleCounts[r.id];
                            const pct = Math.round((rc.weighted / computed.maxWeighted) * 100);
                            return (
                                <td key={r.id}
                                    className={`heatmap-cell summary-cell ${hoveredCol && hoveredCol !== r.id ? 'dimmed' : ''}`}
                                    onMouseEnter={() => setHoveredCol(r.id)}
                                    onMouseLeave={() => setHoveredCol(null)}
                                    style={{ backgroundColor: `${r.color}${Math.round((pct / 100) * 0.4 * 255).toString(16).padStart(2, '0')}` }}>
                                    <span className="pct">{pct}%</span>
                                    <span className="counts">{rc.R}R {rc.A}A</span>
                                </td>
                            );
                        })}
                        {data.meta.has_maturity && <td></td>}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

// ═══════════════════════════════════════════
// View 2: Ownership Sunburst
// ═══════════════════════════════════════════
function SunburstView({ data, computed }) {
    const { roles, categories } = data;
    const { show, hide } = useContext(TooltipCtx);
    const [hoveredArc, setHoveredArc] = useState(null);
    const [detail, setDetail] = useState(null);
    const containerRef = useRef(null);
    const [size, setSize] = useState(560);

    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(entries => {
            const w = entries[0].contentRect.width;
            setSize(Math.min(Math.max(w - 380, 360), 700));
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    const totalItems = categories.reduce((s, c) => s + c.items.length, 0);
    const cx = size / 2, cy = size / 2;
    const scale = size / 600;
    const innerR = 100 * scale, innerR2 = 160 * scale, outerR = 170 * scale, outerR2 = 250 * scale;
    const gap = 0.006;

    const arcs = useMemo(() => {
        const catArcs = [];
        const itemArcs = [];
        let catAngle = 0;
        categories.forEach(cat => {
            const catSweep = (cat.items.length / totalItems) * Math.PI * 2;
            catArcs.push({ id: cat.name, type: 'category', start: catAngle + gap, sweep: catSweep - gap * 2, color: cat.color, label: cat.name, cat });
            let itemAngle = catAngle;
            const itemSweep = catSweep / cat.items.length;
            cat.items.forEach(item => {
                const rRole = roles.find(r => item[r.id] === 'R');
                itemArcs.push({
                    id: `${cat.name}__${item.name}`, type: 'item',
                    start: itemAngle + gap, sweep: itemSweep - gap * 2,
                    color: rRole ? rRole.color : '#303848',
                    label: item.name, category: cat.name, item, ownerLabel: rRole ? rRole.short : '—',
                });
                itemAngle += itemSweep;
            });
            catAngle += catSweep;
        });
        return { catArcs, itemArcs };
    }, [categories, roles, totalItems]);

    const arcPath = (cx, cy, r1, r2, startAngle, sweep) => {
        if (sweep <= 0) return '';
        const s = startAngle - Math.PI / 2;
        const e = s + sweep;
        const x1 = cx + r1 * Math.cos(s), y1 = cy + r1 * Math.sin(s);
        const x2 = cx + r2 * Math.cos(s), y2 = cy + r2 * Math.sin(s);
        const x3 = cx + r2 * Math.cos(e), y3 = cy + r2 * Math.sin(e);
        const x4 = cx + r1 * Math.cos(e), y4 = cy + r1 * Math.sin(e);
        const large = sweep > Math.PI ? 1 : 0;
        return `M${x1},${y1} L${x2},${y2} A${r2},${r2} 0 ${large} 1 ${x3},${y3} L${x4},${y4} A${r1},${r1} 0 ${large} 0 ${x1},${y1}Z`;
    };

    const handleHover = (arc) => {
        setHoveredArc(arc?.id || null);
        if (arc?.type === 'item') {
            const assignments = roles.map(r => ({ role: r.label, short: r.short, color: r.color, raci: arc.item[r.id] || '-' }));
            setDetail({ name: arc.item.name, category: arc.category, assignments, now: arc.item.now, tgt: arc.item.tgt, desc: arc.item.desc });
        } else if (arc?.type === 'category') {
            const cat = arc.cat;
            const stats = computed.maturityStats.find(m => m.name === cat.name);
            setDetail({ name: cat.name, isCategory: true, count: cat.items.length, color: cat.color, avgNow: stats?.avgNow, avgTgt: stats?.avgTgt });
        } else {
            setDetail(null);
        }
    };

    return (
        <div className="sunburst-container" ref={containerRef}>
            <svg className="sunburst-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {arcs.catArcs.map(a => (
                    <path key={a.id} d={arcPath(cx, cy, innerR, innerR2, a.start, a.sweep)}
                        fill={a.color}
                        opacity={hoveredArc && hoveredArc !== a.id && !hoveredArc.startsWith(a.id + '__') ? 0.12 : 0.85}
                        style={{ transition: 'opacity 0.2s', cursor: 'pointer' }}
                        onMouseEnter={() => handleHover(a)} onMouseLeave={() => handleHover(null)} />
                ))}
                {arcs.itemArcs.map(a => (
                    <path key={a.id} d={arcPath(cx, cy, outerR, outerR2, a.start, a.sweep)}
                        fill={a.color}
                        opacity={hoveredArc && hoveredArc !== a.id ? 0.12 : 0.9}
                        style={{ transition: 'opacity 0.2s', cursor: 'pointer' }}
                        onMouseEnter={() => handleHover(a)} onMouseLeave={() => handleHover(null)} />
                ))}
                {/* Center text */}
                {!hoveredArc ? (
                    <>
                        <text x={cx} y={cy - 10} textAnchor="middle" fill="#e0e8f0" fontSize={16 * scale} fontFamily="IBM Plex Sans" fontWeight="600">{totalItems}</text>
                        <text x={cx} y={cy + 10} textAnchor="middle" fill="#8898a8" fontSize={11 * scale} fontFamily="IBM Plex Sans">capabilities</text>
                    </>
                ) : detail && (
                    <>
                        <text x={cx} y={cy - (detail.isCategory ? 4 : 10)} textAnchor="middle" fill="#e0e8f0" fontSize={12 * scale} fontFamily="IBM Plex Sans" fontWeight="600">
                            {detail.name.length > 24 ? detail.name.slice(0, 22) + '..' : detail.name}
                        </text>
                        {detail.isCategory && (
                            <text x={cx} y={cy + 14} textAnchor="middle" fill="#8898a8" fontSize={10 * scale} fontFamily="IBM Plex Sans">{detail.count} items</text>
                        )}
                        {!detail.isCategory && detail.category && (
                            <text x={cx} y={cy + 8} textAnchor="middle" fill="#8898a8" fontSize={10 * scale} fontFamily="IBM Plex Sans">{detail.category}</text>
                        )}
                    </>
                )}
            </svg>
            <div className="sunburst-detail-panel">
                {detail && !detail.isCategory && (
                    <div className="sunburst-detail">
                        <h3>{detail.name}</h3>
                        {detail.desc && <div className="detail-desc">{detail.desc}</div>}
                        <div className="detail-category">{detail.category}</div>
                        <div className="detail-assignments">
                            {detail.assignments.map(a => (
                                <div className="detail-row" key={a.short}>
                                    <span className="detail-label" style={{ color: a.color }}>{a.short}</span>
                                    <span className="detail-role-name">{a.role}</span>
                                    <span className={`detail-badge raci-badge-${a.raci.toLowerCase()}`}>
                                        {a.raci !== '-' ? a.raci : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {(detail.now != null || detail.tgt != null) && (
                            <div className="detail-maturity">
                                <div className="maturity-bar">
                                    <span className="mat-val" style={{ color: MATURITY_COLORS[detail.now ?? 0] }}>{detail.now ?? '?'}</span>
                                    <div className="maturity-track">
                                        {detail.now != null && <div className="maturity-fill-now" style={{ width: `${(detail.now / 5) * 100}%`, backgroundColor: MATURITY_COLORS[detail.now] }} />}
                                        {detail.tgt != null && <div className="maturity-fill-target" style={{ left: 0, width: `${(detail.tgt / 5) * 100}%`, backgroundColor: MATURITY_COLORS[detail.tgt] }} />}
                                    </div>
                                    <span className="mat-val" style={{ color: MATURITY_COLORS[detail.tgt ?? 0] }}>{detail.tgt ?? '?'}</span>
                                </div>
                                {detail.now != null && detail.tgt != null && (
                                    <div className="mat-delta">Gap: +{detail.tgt - detail.now}</div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {detail && detail.isCategory && (
                    <div className="sunburst-detail">
                        <h3 style={{ color: detail.color }}>{detail.name}</h3>
                        <div className="detail-category">{detail.count} capabilities</div>
                        {detail.avgNow != null && (
                            <div className="detail-maturity">
                                <div className="maturity-bar">
                                    <span className="mat-val" style={{ color: MATURITY_COLORS[Math.round(detail.avgNow)] }}>{detail.avgNow.toFixed(1)}</span>
                                    <div className="maturity-track">
                                        <div className="maturity-fill-now" style={{ width: `${(detail.avgNow / 5) * 100}%`, backgroundColor: MATURITY_COLORS[Math.round(detail.avgNow)] }} />
                                        {detail.avgTgt != null && <div className="maturity-fill-target" style={{ left: 0, width: `${(detail.avgTgt / 5) * 100}%`, backgroundColor: MATURITY_COLORS[Math.round(detail.avgTgt)] }} />}
                                    </div>
                                    <span className="mat-val" style={{ color: MATURITY_COLORS[Math.round(detail.avgTgt ?? 0)] }}>{detail.avgTgt?.toFixed(1) ?? '?'}</span>
                                </div>
                                <div className="mat-delta">Avg maturity</div>
                            </div>
                        )}
                    </div>
                )}
                {!detail && (
                    <div className="sunburst-detail sunburst-hint">
                        <p>Hover over arcs to see details</p>
                        <div className="sunburst-legend">
                            <div className="sunburst-legend-title">Inner ring = Categories</div>
                            <div className="sunburst-legend-title">Outer ring = Capabilities</div>
                            <div className="sunburst-legend-title" style={{ marginTop: 8 }}>Color = Primary R owner</div>
                            {roles.map(r => (
                                <div key={r.id} className="sunburst-legend-item">
                                    <span className="legend-dot" style={{ backgroundColor: r.color }}></span>
                                    <span>{r.short}</span>
                                </div>
                            ))}
                            <div className="sunburst-legend-item">
                                <span className="legend-dot" style={{ backgroundColor: '#303848' }}></span>
                                <span>No R assigned</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════
// View 3: Workload Balance
// ═══════════════════════════════════════════
function WorkloadView({ data, computed }) {
    const { roles } = data;
    const { show, hide } = useContext(TooltipCtx);
    const [expanded, setExpanded] = useState(null);
    const [sortBy, setSortBy] = useState('default');

    const sortedRoles = useMemo(() => {
        const arr = [...roles];
        if (sortBy === 'weighted') arr.sort((a, b) => computed.roleCounts[b.id].weighted - computed.roleCounts[a.id].weighted);
        else if (sortBy === 'r-count') arr.sort((a, b) => computed.roleCounts[b.id].R - computed.roleCounts[a.id].R);
        else if (sortBy === 'total') arr.sort((a, b) => computed.roleCounts[b.id].total - computed.roleCounts[a.id].total);
        return arr;
    }, [roles, sortBy, computed]);

    const maxTotal = Math.max(...roles.map(r => computed.roleCounts[r.id].total), 1);

    return (
        <div className="workload-view">
            <div className="workload-sort-bar">
                <span className="sort-label">Sort by:</span>
                {[['default', 'Default'], ['weighted', 'Weighted Load'], ['r-count', 'R Count'], ['total', 'Total']].map(([k, label]) => (
                    <button key={k} className={`sort-btn ${sortBy === k ? 'active' : ''}`} onClick={() => setSortBy(k)}>{label}</button>
                ))}
            </div>
            <div className="workload-container">
                {sortedRoles.map(r => {
                    const rc = computed.roleCounts[r.id];
                    const pct = Math.round((rc.weighted / computed.maxWeighted) * 100);
                    const isExpanded = expanded === r.id;
                    const breakdown = computed.workloadBreakdown[r.id];

                    return (
                        <React.Fragment key={r.id}>
                            <div className="workload-row" onClick={() => setExpanded(isExpanded ? null : r.id)}>
                                <div className="workload-role-label">
                                    <span className="workload-role-dot" style={{ backgroundColor: r.color }}></span>
                                    <span className="workload-role-name">{r.label}</span>
                                    {r.status === 'unfilled' && <span className="workload-unfilled" title="Unfilled role">OPEN</span>}
                                </div>
                                <div className="workload-bar-container">
                                    <div className="workload-bar">
                                        {['R', 'A', 'C', 'I'].map(type => {
                                            const count = rc[type];
                                            if (!count) return null;
                                            const w = (count / maxTotal) * 100;
                                            return (
                                                <div key={type} className="workload-segment"
                                                    style={{ width: `${w}%`, backgroundColor: RACI_COLORS[type], minWidth: count > 0 ? 24 : 0 }}
                                                    onMouseEnter={() => show(<span>{count} {RACI_LABELS[type]} assignments</span>)}
                                                    onMouseLeave={hide}>
                                                    {w > 4 ? `${count}${type}` : count > 0 ? type : ''}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <span className="workload-total">{pct}%</span>
                                </div>
                                <span className={`workload-expand-icon ${isExpanded ? 'open' : ''}`}>&#9662;</span>
                            </div>
                            {isExpanded && breakdown.length > 0 && (
                                <div className="workload-breakdown">
                                    {breakdown.map(b => (
                                        <div className="workload-pill" key={b.cat}>
                                            <span className="pill-dot" style={{ backgroundColor: b.color }}></span>
                                            <span className="pill-cat">{b.cat.length > 20 ? b.cat.slice(0, 18) + '..' : b.cat}</span>
                                            {b.R > 0 && <span style={{ color: RACI_COLORS.R }}>{b.R}R</span>}
                                            {b.A > 0 && <span style={{ color: RACI_COLORS.A }}>{b.A}A</span>}
                                            {b.C > 0 && <span style={{ color: RACI_COLORS.C }}>{b.C}C</span>}
                                            {b.I > 0 && <span style={{ color: RACI_COLORS.I }}>{b.I}I</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════
// View 4: Connection Map
// ═══════════════════════════════════════════
function ConnectionView({ data, computed }) {
    const { roles, categories } = data;
    const containerRef = useRef(null);
    const [positions, setPositions] = useState(null);
    const [hoveredEntity, setHoveredEntity] = useState(null);
    const [showCI, setShowCI] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;
        const update = () => {
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const pos = { roles: {}, categories: {} };
            container.querySelectorAll('.conn-role').forEach(el => {
                const r = el.getBoundingClientRect();
                pos.roles[el.dataset.id] = { x: r.right - rect.left, y: r.top + r.height / 2 - rect.top };
            });
            container.querySelectorAll('.conn-cat').forEach(el => {
                const r = el.getBoundingClientRect();
                pos.categories[el.dataset.name] = { x: r.left - rect.left, y: r.top + r.height / 2 - rect.top };
            });
            setPositions(pos);
        };
        const ro = new ResizeObserver(() => setTimeout(update, 50));
        ro.observe(containerRef.current);
        update();
        return () => ro.disconnect();
    }, [data]);

    const filteredConns = useMemo(() => {
        if (showCI) return computed.connections;
        return computed.connections.filter(c => c.rCount > 0 || c.aCount > 0);
    }, [computed.connections, showCI]);

    const maxWeight = Math.max(...filteredConns.map(c => c.weight), 1);

    const isHighlighted = (conn) => {
        if (!hoveredEntity) return false;
        return conn.roleId === hoveredEntity || conn.category === hoveredEntity;
    };

    return (
        <div>
            <div className="conn-controls">
                <label className="conn-toggle">
                    <input type="checkbox" checked={showCI} onChange={e => setShowCI(e.target.checked)} />
                    <span>Show C/I connections</span>
                </label>
            </div>
            <div className="connection-map" ref={containerRef}>
                <div className="connection-column">
                    <div className="connection-column-title">Roles</div>
                    {roles.map(r => {
                        const rc = computed.roleCounts[r.id];
                        const dimmed = hoveredEntity && hoveredEntity !== r.id &&
                            !filteredConns.some(c => c.roleId === r.id && c.category === hoveredEntity);
                        return (
                            <div key={r.id} className={`connection-card conn-role ${dimmed ? 'dimmed' : ''}`}
                                data-id={r.id}
                                onMouseEnter={() => setHoveredEntity(r.id)}
                                onMouseLeave={() => setHoveredEntity(null)}
                                style={{ borderLeftColor: r.color, borderLeftWidth: 3 }}>
                                <div className="connection-card-name">
                                    {r.label}
                                    {r.status === 'unfilled' && <span className="conn-open-badge">OPEN</span>}
                                </div>
                                <div className="connection-card-stats">
                                    <span style={{ color: RACI_COLORS.R }}>{rc.R}R</span>
                                    <span style={{ color: RACI_COLORS.A }}>{rc.A}A</span>
                                    <span style={{ color: RACI_COLORS.C }}>{rc.C}C</span>
                                    <span style={{ color: RACI_COLORS.I }}>{rc.I}I</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {positions && (
                    <svg className="connection-svg" width="100%" height="100%">
                        {filteredConns.map(conn => {
                            const from = positions.roles[conn.roleId];
                            const to = positions.categories[conn.category];
                            if (!from || !to) return null;
                            const highlighted = isHighlighted(conn);
                            const weight = showCI ? conn.weight : conn.rCount * 4 + conn.aCount * 3;
                            const thickness = Math.max(1.5, (weight / maxWeight) * 8);
                            const midX = (from.x + to.x) / 2;
                            const roleObj = roles.find(r => r.id === conn.roleId);
                            return (
                                <g key={`${conn.roleId}-${conn.category}`}>
                                    <path
                                        d={`M${from.x},${from.y} C${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`}
                                        fill="none"
                                        stroke={roleObj?.color || '#4ae0b0'}
                                        strokeWidth={highlighted ? thickness * 1.2 : thickness}
                                        opacity={hoveredEntity ? (highlighted ? 0.65 : 0.03) : 0.14}
                                        style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }}
                                    />
                                    {highlighted && (
                                        <g>
                                            <rect x={midX - 28} y={(from.y + to.y) / 2 - 12} width={56} height={18}
                                                rx={3} fill="rgba(14,20,32,0.9)" stroke="rgba(30,46,62,0.6)" strokeWidth={1} />
                                            <text x={midX} y={(from.y + to.y) / 2}
                                                textAnchor="middle" fill="#e0e8f0"
                                                fontSize="10" fontFamily="IBM Plex Mono" fontWeight="500">
                                                {conn.rCount}R {conn.aCount}A
                                            </text>
                                        </g>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                )}

                <div className="connection-column">
                    <div className="connection-column-title">Categories</div>
                    {categories.map(c => {
                        const dimmed = hoveredEntity && hoveredEntity !== c.name &&
                            !filteredConns.some(conn => conn.category === c.name && conn.roleId === hoveredEntity);
                        const stats = computed.maturityStats.find(m => m.name === c.name);
                        return (
                            <div key={c.name} className={`connection-card conn-cat ${dimmed ? 'dimmed' : ''}`}
                                data-name={c.name}
                                onMouseEnter={() => setHoveredEntity(c.name)}
                                onMouseLeave={() => setHoveredEntity(null)}
                                style={{ borderLeftColor: c.color, borderLeftWidth: 3 }}>
                                <div className="connection-card-name">{c.name}</div>
                                <div className="connection-card-stats">
                                    <span>{c.items.length} cap</span>
                                    {stats?.avgNow != null && (
                                        <span style={{ color: MATURITY_COLORS[Math.round(stats.avgNow)] }}>
                                            mat {stats.avgNow.toFixed(1)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════
// Detection Panel
// ═══════════════════════════════════════════
function DetectionPanel({ meta }) {
    const cols = meta.column_classifications || {};
    return (
        <div className="detection-panel">
            <h3>Column Detection Results</h3>
            {Object.entries(cols).sort(([a], [b]) => Number(a) - Number(b)).map(([ci, info]) => (
                <div className="detection-row" key={ci}>
                    <span className="detection-col-idx">Col {ci}</span>
                    <span className="detection-header">{info.header || '(empty)'}</span>
                    <span className={`detection-class ${info.classification}`}>{info.classification}</span>
                </div>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════
// Main App
// ═══════════════════════════════════════════
function App() {
    const [data, setData] = useState(null);
    const [view, setView] = useState('Heatmap');
    const [showDetection, setShowDetection] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const fileInputRef = useRef(null);

    const computed = useComputedData(data);

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === 'INPUT') return;
            const num = parseInt(e.key);
            if (num >= 1 && num <= 4) { setView(VIEWS[num - 1].id); e.preventDefault(); }
            if (e.key === '/' && !e.ctrlKey) { document.querySelector('.search-input')?.focus(); e.preventDefault(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (window.__RACI_DATA__) { setData(window.__RACI_DATA__); setLoading(false); return; }
        fetch('/api/data')
            .then(r => { if (!r.ok) throw new Error('No data'); return r.json(); })
            .then(d => { setData(d); setLoading(false); })
            .catch(() => { setLoading(false); });
    }, []);

    const handleFile = useCallback((file) => {
        setError(null);
        const ext = file.name.split('.').pop().toLowerCase();
        if (['xlsx', 'xls', 'csv'].includes(ext)) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const parsed = parseXLSXInBrowser(wb);
                    parsed.meta.filename = file.name;
                    setData(parsed);
                } catch (parseErr) {
                    const formData = new FormData();
                    formData.append('file', file);
                    fetch('/api/upload', { method: 'POST', body: formData })
                        .then(r => r.json())
                        .then(d => { if (d.error) { setError(d.error); return; } setData(d); })
                        .catch(err => setError(`Upload failed: ${err.message}`));
                }
            };
            reader.readAsArrayBuffer(file);
        }
    }, []);

    const handleDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
    const handleDragLeave = useCallback(() => setDragging(false), []);
    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);
    const handleFileInput = useCallback((e) => { const file = e.target.files[0]; if (file) handleFile(file); }, [handleFile]);

    const exportJSON = useCallback(() => {
        if (!data) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `raci-${data.meta.filename.replace(/\.[^.]+$/, '')}.json`;
        a.click();
    }, [data]);

    if (loading) return <div className="loading"><div className="loading-spinner"></div>Loading...</div>;

    return (
        <TooltipProvider>
            <div onDragOver={handleDragOver} onDrop={handleDrop} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
                {dragging && (
                    <div className="drop-zone-overlay" onDragLeave={handleDragLeave}>
                        <div className="drop-zone-box">
                            <h2>Drop your RACI file</h2>
                            <p>.xlsx, .xls, or .csv</p>
                        </div>
                    </div>
                )}

                <div className="dashboard-header">
                    <div className="header-left">
                        <span className="header-logo">RACI</span>
                        {data && (
                            <>
                                <span className="header-filename">{data.meta.filename}</span>
                                <div className="header-stats">
                                    <span><span className="stat-num">{data.meta.category_count}</span> categories</span>
                                    <span><span className="stat-num">{data.meta.capability_count}</span> capabilities</span>
                                    <span><span className="stat-num">{data.meta.role_count}</span> roles</span>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="header-right">
                        {data && (
                            <>
                                <div className="search-box">
                                    <span className="search-icon">&#x2315;</span>
                                    <input type="text" className="search-input" placeholder="Filter... ( / )"
                                        value={search} onChange={e => setSearch(e.target.value)} />
                                    {search && <button className="search-clear" onClick={() => setSearch('')}>&#x2715;</button>}
                                </div>
                                <button className={`detection-toggle ${showDetection ? 'active' : ''}`}
                                    onClick={() => setShowDetection(!showDetection)}>Detection</button>
                                <button className="export-btn" onClick={exportJSON}>Export JSON</button>
                                <div className="tab-bar">
                                    {VIEWS.map(v => (
                                        <button key={v.id} className={`tab-btn ${view === v.id ? 'active' : ''}`}
                                            onClick={() => setView(v.id)}>
                                            {v.id}
                                            <span className="tab-key">{v.key}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        <input type="file" ref={fileInputRef} onChange={handleFileInput} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />
                        <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>Upload</button>
                    </div>
                </div>

                {data && <RaciLegend />}

                {error && (
                    <div className="error-bar">{error}
                        <button className="error-dismiss" onClick={() => setError(null)}>&#x2715;</button>
                    </div>
                )}

                <div className="dashboard-content">
                    {!data ? (
                        <div className="welcome-screen">
                            <div className="welcome-box">
                                <h1>RACI Dashboard</h1>
                                <p>Drop a RACI spreadsheet (.xlsx, .csv) anywhere on this page, or click below to upload.</p>
                                <button className="welcome-upload-btn" onClick={() => fileInputRef.current?.click()}>Choose File</button>
                                <div className="welcome-formats">
                                    <span>Supports: inline categories, explicit category columns, RACI-only, maturity columns, any header names</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            {showDetection && <DetectionPanel meta={data.meta} />}
                            {view === 'Heatmap' && <HeatmapView data={data} computed={computed} search={search} />}
                            {view === 'Sunburst' && <SunburstView data={data} computed={computed} />}
                            {view === 'Workload' && <WorkloadView data={data} computed={computed} />}
                            {view === 'Connections' && <ConnectionView data={data} computed={computed} />}
                        </>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
