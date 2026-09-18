"""Canonical legacy-client extractor for CobrosyPagos-GDemos-2.bak (read-only).

Emits clients_extract.json (merged records) and clients_extract.csv.
"""
from pathlib import Path
import struct, json, re, csv

BAK = Path(r"C:\Users\Rardiel Ceballo\Downloads\CobrosyPagos\CobrosyPagos-GDemos-2.bak")
OUT = Path(__file__).resolve().parent
b = BAK.read_bytes()

def u16(p): return struct.unpack("<H", b[p:p+2])[0]

def try_layout(R, fixed, nvar):
    arr = R + fixed - 2*nvar
    if arr < 0 or arr + 2*nvar > len(b): return None
    o = [u16(arr + 2*k) for k in range(nvar)]
    if not all(o[i] >= o[i-1] for i in range(1, nvar)): return None
    if o[0] < fixed or o[-1] > 4096 or o[-1] - fixed < 3: return None
    fields, prev = [], fixed
    for k in range(nvar):
        seg = b[R+prev:R+o[k]]
        if any(x < 9 or x > 126 for x in seg): return None
        fields.append(seg.decode("ascii")); prev = o[k]
    return fields

# --- short index: C0000x code + name ---
lo, hi = 2_163_314, 2_165_200
index = {}
for m in re.finditer(rb"C(\d{5})", b[lo:hi]):
    code = "C" + m.group(1).decode()
    s = m.end(); run = bytearray()
    while s < len(b) - lo and 0x20 <= b[lo+s] < 0x7f:
        run.append(b[lo+s]); s += 1
    name = run.decode("ascii").rstrip("0").strip()
    index.setdefault(code, name)

# --- data pages: two record layouts ---
LO, HI = 2_430_000, 2_445_000
raw, R = [], LO
while R < HI:
    for fixed, nvar in ((116, 9), (102, 2)):
        f = try_layout(R, fixed, nvar)
        if f:
            raw.append({"off": R, "fixed": fixed, "nvar": nvar, "fields": f})
            break
    R += 1

seen, uniq = set(), []
for rec in raw:
    key = tuple(rec["fields"])
    if key not in seen:
        seen.add(key); uniq.append(rec)

def norm(s): return re.sub(r"\s+", " ", s or "").strip().lower()

idx_by_name = {norm(v): k for k, v in index.items()}
clients = []
for rec in uniq:
    f = rec["fields"]
    if rec["nvar"] == 9:
        ident, name = f[0], f[1]
        extra = {"alias": f[2].strip(), "sector": f[3].strip(), "phone": f[4].strip(),
                 "cell": f[5].strip(), "address": f[6].strip(), "note": f[7].strip(),
                 "email": f[8].strip()}
    else:
        ident, name = f[0], f[1]
        extra = {"alias": "", "sector": "", "phone": "", "cell": "",
                 "address": "", "note": "", "email": ""}
    code = idx_by_name.get(norm(name), "")
    clients.append({"legacy_code": code, "legacy_id": ident.strip(),
                    "name": name.strip(), **extra})

clients.sort(key=lambda c: (c["legacy_code"], c["name"]))

(OUT / "clients_extract.json").write_text(
    json.dumps({"source": str(BAK), "count": len(clients), "clients": clients},
               ensure_ascii=False, indent=1), encoding="utf-8")

cols = ["legacy_code","legacy_id","name","alias","sector","phone","cell","address","note","email"]
with (OUT / "clients_extract.csv").open("w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
    for c in clients: w.writerow(c)

print("index codes:", len(index))
print("unique data records:", len(uniq))
print("merged clients:", len(clients))
print("with code match:", sum(1 for c in clients if c["legacy_code"]))
print("--- sample ---")
for c in clients[:8]:
    print(json.dumps(c, ensure_ascii=False))
