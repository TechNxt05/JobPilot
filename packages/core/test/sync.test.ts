import { describe, expect, it } from "vitest";
import { jobKey, mergeRecords, syncAll, type CollectionName, type RemoteRow, type SyncAdapter, type SyncRecord, type Tombstones } from "../src";

type R = SyncRecord & { v: string };
const rec = (id: string, updatedAt: number, v = id): R => ({ id, updatedAt, v });
const row = (r: R, deletedAt: number | null = null): RemoteRow<R> => ({ id: r.id, updatedAt: r.updatedAt, deletedAt, data: deletedAt ? null : r });

describe("mergeRecords", () => {
  it("pushes local-only, pulls remote-only", () => {
    const m = mergeRecords([rec("a", 1)], {}, [row(rec("b", 2))]);
    expect(m.local.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(m.upserts.map((r) => r.id)).toEqual(["a"]);
  });

  it("newer side wins", () => {
    const m = mergeRecords([rec("a", 5, "local"), rec("b", 1, "old")], {}, [row(rec("a", 3, "remote")), row(rec("b", 9, "new"))]);
    expect(Object.fromEntries(m.local.map((r) => [r.id, r.v]))).toEqual({ a: "local", b: "new" });
    expect(m.upserts.map((r) => r.id)).toEqual(["a"]);
  });

  it("propagates deletes both ways", () => {
    const local: Tombstones = { a: 10 };
    const m = mergeRecords([rec("b", 1)], local, [row(rec("a", 5)), row(rec("b", 1), 7)]);
    expect(m.deletes).toEqual([{ id: "a", deletedAt: 10 }]);
    expect(m.local).toEqual([]); // b was deleted remotely after its last local edit
    expect(m.tombstones).toMatchObject({ a: 10, b: 7 });
  });

  it("an edit newer than a remote delete resurrects the record", () => {
    const m = mergeRecords([rec("a", 20)], {}, [row(rec("a", 5), 10)]);
    expect(m.upserts.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("syncAll", () => {
  it("converges two devices through the server", async () => {
    const server: Record<string, RemoteRow<SyncRecord>[]> = {};
    const device = () => {
      const data: Record<string, { records: SyncRecord[]; tombstones: Tombstones }> = {};
      const adapter: SyncAdapter = {
        readLocal: async (c) => data[c] ?? { records: [], tombstones: {} },
        writeLocal: async (c, records, tombstones) => { data[c] = { records, tombstones }; },
        fetchRemote: async (c) => server[c] ?? [],
        upsertRemote: async (c, records) => {
          const rows = (server[c] ??= []);
          for (const r of records) {
            const i = rows.findIndex((x) => x.id === r.id);
            const nr = { id: r.id, updatedAt: r.updatedAt, deletedAt: null, data: r };
            if (i >= 0) rows[i] = nr; else rows.push(nr);
          }
        },
        deleteRemote: async (c, dels) => {
          for (const d of dels) {
            const r = (server[c] ?? []).find((x) => x.id === d.id);
            if (r) Object.assign(r, { deletedAt: d.deletedAt, data: null, updatedAt: d.deletedAt });
          }
        },
      };
      return { data, adapter };
    };
    const A = device(), B = device();
    const c: CollectionName = "answers";
    A.data[c] = { records: [rec("q1", 1, "from A")], tombstones: {} };
    await syncAll(A.adapter, [c]);
    const rb = await syncAll(B.adapter, [c]);
    expect(rb.pulled).toBe(1);
    expect((B.data[c].records[0] as R).v).toBe("from A");

    // B deletes, A syncs → gone on A too
    B.data[c] = { records: [], tombstones: { q1: 5 } };
    await syncAll(B.adapter, [c]);
    expect(B.data[c].tombstones).toEqual({}); // server knows, tombstone dropped
    await syncAll(A.adapter, [c]);
    expect(A.data[c].records).toEqual([]);
  });
});

describe("jobKey", () => {
  it("ignores tracking params but keeps job ids", () => {
    expect(jobKey("https://www.linkedin.com/jobs/view/123/?trk=abc&refId=x")).toBe("linkedin.com/jobs/view/123");
    expect(jobKey("https://in.indeed.com/viewjob?jk=abc123&from=serp")).toBe("in.indeed.com/viewjob?jk=abc123");
  });
});
