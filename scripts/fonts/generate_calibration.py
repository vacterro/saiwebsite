import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.fonts.build_pixel_fonts import wanted, UI_SIZES, ITALIC_SIZES, UNITS
from scripts.fonts.reference import resolve_canonical

LOCAL_REF_FONTS = ROOT / "_local_ref" / "fonts"
OUT_FILE = Path(__file__).resolve().parent / "calibration_metrics.json"

def extract_all_metrics(font_path: Path, ppem: int) -> dict[str, list[int]]:
    font = TTFont(font_path)
    pil_font = ImageFont.truetype(str(font_path), ppem)
    eblc = font['EBLC']
    ebdt = font['EBDT']
    cmap = font.getBestCmap()
    rev_cmap: dict[str, list[int]] = {}
    for cp, name in cmap.items():
        rev_cmap.setdefault(name, []).append(cp)
    
    strike = None
    strike_idx = None
    for i, s in enumerate(eblc.strikes):
        if s.bitmapSizeTable.ppemY == ppem:
            strike = s
            strike_idx = i
            break
    if strike is None:
        return {}
        
    res: dict[str, list[int]] = {}
    data = ebdt.strikeData[strike_idx]
    for sub in strike.indexSubTables:
        for gname in sub.names:
            cps = rev_cmap.get(gname, [])
            if not cps:
                continue
            adv = bx = None
            if gname in data:
                g = data[gname]
                if hasattr(g, 'metrics'):
                    adv = getattr(g.metrics, 'Advance', getattr(g.metrics, 'horiAdvance', None))
                    bx = getattr(g.metrics, 'BearingX', getattr(g.metrics, 'horiBearingX', None))
            if adv is None and hasattr(sub, 'metrics'):
                adv = getattr(sub.metrics, 'Advance', getattr(sub.metrics, 'horiAdvance', None))
                bx = getattr(sub.metrics, 'BearingX', getattr(sub.metrics, 'horiBearingX', None))
            if adv is not None and bx is not None:
                for cp in cps:
                    if wanted(cp):
                        res[str(cp)] = [adv, bx]
                
    if "space" in data and hasattr(data["space"], "metrics"):
        sp_adv = getattr(data["space"].metrics, "Advance", getattr(data["space"].metrics, "horiAdvance", None))
    else:
        sp_adv = round(pil_font.getlength(' '))
    res["32"] = [sp_adv, 0]
    res["160"] = [sp_adv, 0]
    return res

def extract_from_woff2(woff2_path: Path, ppem: int, style: str) -> dict[str, list[int]]:
    font = TTFont(woff2_path)
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    res: dict[str, list[int]] = {}
    for cp, name in cmap.items():
        if wanted(cp) and name in hmtx.metrics:
            adv = hmtx.metrics[name][0] // UNITS
            bx = hmtx.metrics[name][1] // UNITS
            res[str(cp)] = [adv, bx]
    # Ensure space metrics
    if style == "bold":
        sp_adv = 5 if ppem in (10, 11) else (6 if ppem in (12, 14) else 7)
    elif style == "italic":
        sp_adv = 5
    else:
        sp_adv = 4 if ppem == 10 else (5 if ppem in (11, 12) else (6 if ppem == 14 else 7))
    res["32"] = [sp_adv, 0]
    res["160"] = [sp_adv, 0]
    return res

def main() -> None:
    reg_font = resolve_canonical("regular")
    bold_font = resolve_canonical("bold")
    it_font = resolve_canonical("italic")

    calibration = {
        "note": "Screen pixel bitmap rhythm calibration metrics (advance width, left bearing) per size and style.",
        "regular": {},
        "bold": {},
        "italic": {},
    }

    for ppem in UI_SIZES:
        if reg_font:
            calibration["regular"][str(ppem)] = extract_all_metrics(reg_font, ppem)
        elif (LOCAL_REF_FONTS / f"ref-pixel-{ppem}-regular.woff2").exists():
            calibration["regular"][str(ppem)] = extract_from_woff2(LOCAL_REF_FONTS / f"ref-pixel-{ppem}-regular.woff2", ppem, "regular")
        
        if bold_font:
            calibration["bold"][str(ppem)] = extract_all_metrics(bold_font, ppem)
        elif (LOCAL_REF_FONTS / f"ref-pixel-{ppem}-bold.woff2").exists():
            calibration["bold"][str(ppem)] = extract_from_woff2(LOCAL_REF_FONTS / f"ref-pixel-{ppem}-bold.woff2", ppem, "bold")

    for ppem in ITALIC_SIZES:
        if it_font:
            calibration["italic"][str(ppem)] = extract_all_metrics(it_font, ppem)
        elif (LOCAL_REF_FONTS / f"ref-pixel-{ppem}-italic.woff2").exists():
            calibration["italic"][str(ppem)] = extract_from_woff2(LOCAL_REF_FONTS / f"ref-pixel-{ppem}-italic.woff2", ppem, "italic")

    OUT_FILE.write_text(json.dumps(calibration, separators=(',', ':')), encoding="utf-8")
    print(f"Written calibration metrics to {OUT_FILE}")

if __name__ == "__main__":
    main()
