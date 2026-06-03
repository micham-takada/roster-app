"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Student = {
  class: string;
  grade?: string;
  group?: string;
  number?: string;
  name: string;
};

type EncodingMode = "auto" | "utf-8" | "shift-jis";

type SavedRoster = {
  id: string;
  name: string;
  createdAt: number;
  students: Student[];
};

type DrawHistory = {
  id: string;
  rosterId: string;
  className: string;
  pickedAt: number;
  student: Student;
};

// ------------------------------
// IndexedDB
// ------------------------------
const DB_NAME = "roster-app-db";
const DB_VERSION = 1;
const ROSTER_STORE = "rosters";
const HISTORY_STORE = "history";
const SETTINGS_STORE = "settings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(ROSTER_STORE)) {
        db.createObjectStore(ROSTER_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
        store.createIndex("rosterId", "rosterId", { unique: false });
        store.createIndex("pickedAt", "pickedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putRoster(roster: SavedRoster) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ROSTER_STORE, "readwrite");
    tx.objectStore(ROSTER_STORE).put(roster);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllRosters(): Promise<SavedRoster[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ROSTER_STORE, "readonly");
    const req = tx.objectStore(ROSTER_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as SavedRoster[]);
    req.onerror = () => reject(req.error);
  });
}

async function getRoster(id: string): Promise<SavedRoster | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ROSTER_STORE, "readonly");
    const req = tx.objectStore(ROSTER_STORE).get(id);
    req.onsuccess = () => resolve(req.result as SavedRoster | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRoster(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ROSTER_STORE, HISTORY_STORE], "readwrite");
    tx.objectStore(ROSTER_STORE).delete(id);

    const index = tx.objectStore(HISTORY_STORE).index("rosterId");
    const req = index.openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putHistory(item: DrawHistory) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getHistoryByRoster(rosterId: string): Promise<DrawHistory[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readonly");
    const index = tx.objectStore(HISTORY_STORE).index("rosterId");
    const req = index.getAll(rosterId);
    req.onsuccess = () => resolve((req.result || []) as DrawHistory[]);
    req.onerror = () => reject(req.error);
  });
}

async function clearHistoryByRoster(rosterId: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    const index = tx.objectStore(HISTORY_STORE).index("rosterId");
    const req = index.openCursor(IDBKeyRange.only(rosterId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putSetting(key: string, value: unknown) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readwrite");
    tx.objectStore(SETTINGS_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

// ------------------------------
// CSV / TSV パース
// ------------------------------
function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };

  const pushRow = () => {
    pushCell();
    if (row.some((c) => c.trim().length > 0)) {
      rows.push(row.map((c) => c.trim()));
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (ch === "," || ch === "\t")) {
      pushCell();
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      pushRow();
      continue;
    }

    cur += ch;
  }

  if (cur.length > 0 || row.length > 0) pushRow();

  return rows;
}

// ------------------------------
// エンコード
// ------------------------------
function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

async function readFileAsText(file: File, mode: EncodingMode): Promise<string> {
  const buf = await file.arrayBuffer();

  const tryDecode = (enc: string) => {
    const dec = new TextDecoder(enc as any, { fatal: false });
    return dec.decode(buf);
  };

  const scoreGarbled = (s: string) => {
    const repl = (s.match(/\uFFFD/g) || []).length;
    return repl;
  };

  try {
    if (mode === "utf-8") return stripBom(tryDecode("utf-8"));
    if (mode === "shift-jis") return stripBom(tryDecode("shift-jis"));

    const utf8 = stripBom(tryDecode("utf-8"));
    if (scoreGarbled(utf8) === 0) return utf8;

    const sjis = stripBom(tryDecode("shift-jis"));
    return scoreGarbled(sjis) <= scoreGarbled(utf8) ? sjis : utf8;
  } catch {
    const reader = new FileReader();
    const text = await new Promise<string>((resolve, reject) => {
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result ?? ""));
      if (mode === "shift-jis") reader.readAsText(file, "shift-jis");
      else reader.readAsText(file, "utf-8");
    });
    return stripBom(text);
  }
}

// ------------------------------
// 横4列ブロックの名簿形式を読み取る
// ------------------------------
function normalizeHeader(h: string) {
  return h.replace(/\s+/g, "").trim();
}

function parseRosterBlocks(rows: string[][]): Student[] {
  if (rows.length < 3) return [];

  const classRow = rows[0] ?? [];
  const headerRow = rows[1] ?? [];
  const dataRows = rows.slice(2);

  const students: Student[] = [];

  for (let startCol = 0; startCol < headerRow.length; startCol += 4) {
    const className = (classRow[startCol] ?? "").trim();
    if (!className) continue;

    const headers = [0, 1, 2, 3].map((o) =>
      normalizeHeader(headerRow[startCol + o] ?? "")
    );

    const idxGrade = headers.findIndex((h) => ["学年", "grade"].includes(h));
    const idxGroup = headers.findIndex((h) => ["組", "group", "クラス"].includes(h));
    const idxNumber = headers.findIndex((h) =>
      ["出席番号", "番号", "no", "number"].includes(h)
    );
    const idxName = headers.findIndex((h) => ["氏名", "名前", "name"].includes(h));

    const gI = idxGrade >= 0 ? idxGrade : 0;
    const grI = idxGroup >= 0 ? idxGroup : 1;
    const nI = idxNumber >= 0 ? idxNumber : 2;
    const nmI = idxName >= 0 ? idxName : 3;

    for (const r of dataRows) {
      const grade = (r[startCol + gI] ?? "").trim();
      const group = (r[startCol + grI] ?? "").trim();
      const number = (r[startCol + nI] ?? "").trim();
      const name = (r[startCol + nmI] ?? "").trim();

      if (!grade && !group && !number && !name) continue;
      if (!name) continue;

      students.push({
        class: className,
        grade: grade || undefined,
        group: group || undefined,
        number: number || undefined,
        name,
      });
    }
  }

  return students;
}

// ------------------------------
// UI helpers
// ------------------------------
function keyOf(s: Student) {
  return `${s.class}__${s.number ?? ""}__${s.name}`;
}

export default function Page() {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [picked, setPicked] = useState<Student | null>(null);

  const [noRepeat, setNoRepeat] = useState(true);
  const [pickedKeys, setPickedKeys] = useState<Set<string>>(new Set());

  const [encodingMode, setEncodingMode] = useState<EncodingMode>("auto");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [rosters, setRosters] = useState<SavedRoster[]>([]);
  const [activeRosterId, setActiveRosterId] = useState<string>("");
  const [history, setHistory] = useState<DrawHistory[]>([]);

  const classes = useMemo(() => {
    const set = new Set(students.map((s) => s.class));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [students]);

  const studentsInClass = useMemo(() => {
    const list = students.filter((s) => s.class === selectedClass);
    return list.sort((a, b) => {
      const an = Number(a.number);
      const bn = Number(b.number);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return (a.number ?? "").localeCompare(b.number ?? "", "ja");
    });
  }, [students, selectedClass]);

  const remainingInClass = useMemo(() => {
    if (!noRepeat) return studentsInClass;
    return studentsInClass.filter((s) => !pickedKeys.has(keyOf(s)));
  }, [studentsInClass, noRepeat, pickedKeys]);

  // 初期復元
  useEffect(() => {
    (async () => {
      const savedRosters = await getAllRosters();
      setRosters(savedRosters);

      const lastRosterId = await getSetting<string>("lastRosterId");
      const savedNoRepeat = localStorage.getItem("noRepeat");
      const savedEncoding = localStorage.getItem("encodingMode");

      if (savedNoRepeat !== null) setNoRepeat(savedNoRepeat === "true");
      if (
        savedEncoding === "auto" ||
        savedEncoding === "utf-8" ||
        savedEncoding === "shift-jis"
      ) {
        setEncodingMode(savedEncoding);
      }

      if (lastRosterId) {
        const roster = await getRoster(lastRosterId);
        if (roster) {
          setActiveRosterId(roster.id);
          setStudents(roster.students);
          setSelectedClass(roster.students[0]?.class || "");
          const h = await getHistoryByRoster(roster.id);
          setHistory(h);
          setPickedKeys(new Set(h.map((x) => keyOf(x.student))));
        }
      }
    })();
  }, []);

  // 設定保持
  useEffect(() => {
    localStorage.setItem("noRepeat", String(noRepeat));
  }, [noRepeat]);

  useEffect(() => {
    localStorage.setItem("encodingMode", encodingMode);
  }, [encodingMode]);

  // Service Worker 登録

  useEffect(() => {
    if (
      "serviceWorker" in navigator &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await readFileAsText(file, encodingMode);
    const rows = parseDelimited(text);
    const parsed = parseRosterBlocks(rows);

    if (parsed.length === 0) {
      alert(
        "生徒データを読み取れませんでした。\n" +
          "・1行目にクラス名（A1/E1…）\n" +
          "・2行目に「学年/組/出席番号/氏名」\n" +
          "・3行目以降にデータ\n" +
          "の形式か確認してください。\n\n" +
          "※文字化けしているなら「文字コード」を Shift_JIS に切り替えて再読み込みしてください。"
      );
      return;
    }

    const rosterId = `roster-${Date.now()}`;
    const rosterName = file.name.replace(/\.[^.]+$/, "");

    const roster: SavedRoster = {
      id: rosterId,
      name: rosterName,
      createdAt: Date.now(),
      students: parsed,
    };

    await putRoster(roster);
    await putSetting("lastRosterId", rosterId);

    const savedRosters = await getAllRosters();
    setRosters(savedRosters);

    setActiveRosterId(rosterId);
    setStudents(parsed);
    setSelectedClass(parsed[0].class);
    setPicked(null);
    setPickedKeys(new Set());
    setHistory([]);
  }

  async function pickRandom() {
    if (!selectedClass) return;

    const pool = remainingInClass;
    if (pool.length === 0) {
      alert(noRepeat ? "このクラスは全員引き終わりました" : "生徒がいません");
      return;
    }

    const idx = Math.floor(Math.random() * pool.length);
    const s = pool[idx];
    setPicked(s);

    if (noRepeat) {
      const next = new Set(pickedKeys);
      next.add(keyOf(s));
      setPickedKeys(next);
    }

    if (activeRosterId) {
      const item: DrawHistory = {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        rosterId: activeRosterId,
        className: s.class,
        pickedAt: Date.now(),
        student: s,
      };
      await putHistory(item);
      const h = await getHistoryByRoster(activeRosterId);
      setHistory(h);
    }
  }

  async function resetClass() {
    const next = new Set(pickedKeys);
    for (const s of studentsInClass) next.delete(keyOf(s));
    setPickedKeys(next);
    setPicked(null);

    if (activeRosterId) {
      const rest = history.filter((h) => h.className !== selectedClass);
      await clearHistoryByRoster(activeRosterId);
      for (const item of rest) await putHistory(item);
      setHistory(await getHistoryByRoster(activeRosterId));
    }
  }

  async function resetAll() {
    setPickedKeys(new Set());
    setPicked(null);

    if (activeRosterId) {
      await clearHistoryByRoster(activeRosterId);
      setHistory([]);
    }
  }

  // 起動直後：保存済み名簿がなければボタンだけ
  if (students.length === 0 && rosters.length === 0) {
    return (
      <main
        style={{
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
        }}
      >
        <label
          style={{
            padding: "18px 28px",
            borderRadius: 16,
            background: "#2563eb",
            color: "white",
            fontSize: 20,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 10px 20px rgba(37, 99, 235, 0.25)",
          }}
        >
          CSVを選択
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.txt,text/plain"
            onChange={onFile}
            style={{ display: "none" }}
          />
        </label>
      </main>
    );
  }

  // 保存済み名簿はあるが現在未読み込み、というケースを一応フォールバック表示
  if (students.length === 0 && rosters.length > 0) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
          padding: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 16,
            width: "min(520px, 100%)",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 20,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24 }}>保存済み名簿</h1>

          <select
            value={activeRosterId}
            onChange={async (e) => {
              const id = e.target.value;
              setActiveRosterId(id);
              await putSetting("lastRosterId", id);

              const roster = await getRoster(id);
              if (roster) {
                setStudents(roster.students);
                setSelectedClass(roster.students[0]?.class || "");
                setPicked(null);
                const h = await getHistoryByRoster(id);
                setHistory(h);
                setPickedKeys(new Set(h.map((x) => keyOf(x.student))));
              }
            }}
            style={{
              fontSize: 16,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
            }}
          >
            <option value="">選択してください</option>
            {rosters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <label
            style={{
              padding: "16px 24px",
              borderRadius: 16,
              background: "#2563eb",
              color: "white",
              fontSize: 20,
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            新しいCSVを選択
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,.txt,text/plain"
              onChange={onFile}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 980,
        margin: "0 auto",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>
        次は誰？
      </h1>

      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 12,
          display: "grid",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              background: "#2563eb",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ファイルを選択
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,.txt,text/plain"
              onChange={onFile}
              style={{ display: "none" }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={noRepeat}
              onChange={(e) => {
                setNoRepeat(e.target.checked);
                setPicked(null);
              }}
            />
            <span>重複なし（同じ生徒を2回引かない）</span>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#334155" }}>文字コード：</span>
          <select
            value={encodingMode}
            onChange={(e) => setEncodingMode(e.target.value as EncodingMode)}
            style={{
              fontSize: 16,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "white",
            }}
          >
            <option value="auto">自動（推奨）</option>
            <option value="utf-8">UTF-8</option>
            <option value="shift-jis">Shift_JIS</option>
          </select>
        </div>

        {rosters.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "#334155" }}>保存済み名簿：</span>
            <select
              value={activeRosterId}
              onChange={async (e) => {
                const id = e.target.value;
                setActiveRosterId(id);
                await putSetting("lastRosterId", id);

                const roster = await getRoster(id);
                if (roster) {
                  setStudents(roster.students);
                  setSelectedClass(roster.students[0]?.class || "");
                  setPicked(null);
                  const h = await getHistoryByRoster(id);
                  setHistory(h);
                  setPickedKeys(new Set(h.map((x) => keyOf(x.student))));
                }
              }}
              style={{
                fontSize: 16,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "white",
              }}
            >
              {rosters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <button
              onClick={async () => {
                if (!activeRosterId) return;
                const ok = confirm("この名簿と履歴を削除しますか？");
                if (!ok) return;

                await deleteRoster(activeRosterId);
                const savedRosters = await getAllRosters();
                setRosters(savedRosters);

                const nextId = savedRosters[0]?.id ?? "";
                setActiveRosterId(nextId);
                await putSetting("lastRosterId", nextId);

                if (nextId) {
                  const roster = await getRoster(nextId);
                  if (roster) {
                    setStudents(roster.students);
                    setSelectedClass(roster.students[0]?.class || "");
                    setHistory(await getHistoryByRoster(nextId));
                    setPickedKeys(new Set((await getHistoryByRoster(nextId)).map((x) => keyOf(x.student))));
                  }
                } else {
                  setStudents([]);
                  setSelectedClass("");
                  setHistory([]);
                  setPickedKeys(new Set());
                }
                setPicked(null);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "white",
                cursor: "pointer",
              }}
            >
              この名簿を削除
            </button>
          </div>
        )}

        <div style={{ color: "#111827" }}>
          読み込み済み：{classes.length}クラス
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 1fr) 2fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* 左：クラス選択 */}
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
          }}
        >
          <h2 style={{ fontSize: 18, marginTop: 0 }}>クラス選択</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {classes.map((c) => (
              <label
                key={c}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: c === selectedClass ? "#eef2ff" : "transparent",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="class"
                  value={c}
                  checked={selectedClass === c}
                  onChange={() => {
                    setSelectedClass(c);
                    setPicked(null);
                  }}
                />
                <span style={{ fontSize: 16 }}>{c}</span>
              </label>
            ))}
          </div>
        </section>

        {/* 右：抽選 */}
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <h2 style={{ fontSize: 18, margin: 0 }}>次は誰？（{selectedClass}）</h2>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={pickRandom}
                style={{
                  padding: "12px 16px",
                  fontSize: 17,
                  borderRadius: 12,
                  border: "1px solid #111827",
                  background: "#111827",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                ランダムに選ぶ
              </button>
              <button
                onClick={resetClass}
                style={{
                  padding: "12px 16px",
                  fontSize: 16,
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                このクラスをリセット
              </button>
              <button
                onClick={resetAll}
                style={{
                  padding: "12px 16px",
                  fontSize: 16,
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                全リセット
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 14,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              minHeight: 96,
              display: "flex",
              alignItems: "center",
            }}
          >
            {picked ? (
              <div style={{ width: "100%" }}>
                <div style={{ fontSize: 14, color: "#64748b" }}>選ばれた生徒</div>
                <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2 }}>
                  {picked.group ? `${picked.group}組` : ""}
                  {picked.number ? `${picked.number}席 ` : ""}
                  {picked.name}さん
                </div>
              </div>
            ) : (
              <div style={{ color: "#64748b" }}>「ランダムに選ぶ」を押すと表示されます</div>
            )}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer" }}>このクラスの名簿を見る</summary>

            <div
              style={{
                marginTop: 8,
                maxHeight: 260,
                overflow: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 14,
              }}
            >
              {studentsInClass.map((s) => {
                const done = noRepeat && pickedKeys.has(keyOf(s));
                return (
                  <div
                    key={keyOf(s)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "70px 1fr 110px",
                      gap: 10,
                      padding: "10px 12px",
                      borderBottom: "1px solid #e5e7eb",
                      background: done ? "#ecfeff" : "white",
                      color: done ? "#0f766e" : "#111827",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ opacity: 0.9 }}>{s.number ?? ""}</div>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div style={{ textAlign: "right", color: done ? "#0f766e" : "#64748b" }}>
                      {done ? "✓ 抽選済み" : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          {history.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <h3 style={{ fontSize: 16, marginBottom: 8, marginTop: 0 }}>抽選履歴</h3>
                <button
                  onClick={async () => {
                    if (!activeRosterId) return;
                    const ok = confirm("この名簿の抽選履歴を削除しますか？");
                    if (!ok) return;
                    await clearHistoryByRoster(activeRosterId);
                    setHistory([]);
                    setPickedKeys(new Set());
                    setPicked(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #e5e7eb",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  履歴を削除
                </button>
              </div>

              <div
                style={{
                  maxHeight: 220,
                  overflow: "auto",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                }}
              >
                {history
                  .slice()
                  .sort((a, b) => b.pickedAt - a.pickedAt)
                  .map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #e5e7eb",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span>
                        {item.student.group ? `${item.student.group}組` : ""}
                        {item.student.number ? `${item.student.number}席 ` : ""}
                        {item.student.name}さん
                      </span>
                      <span style={{ color: "#64748b", fontSize: 12 }}>
                        {new Date(item.pickedAt).toLocaleString("ja-JP")}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}