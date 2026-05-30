import { useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { runtime } from "../pyodide/instance";
import { useAppStore } from "../state/store";
import type { OpenRadio } from "../state/store";
import type { MemoryDict } from "../pyodide/types";
import { errMsg } from "../lib/err";

interface Props {
  radio: OpenRadio;
}

function formatMHz(freq: number): string {
  if (!freq) return "";
  return (freq / 1_000_000).toFixed(6);
}

function parseMHz(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 1_000_000);
}

export function MemoryEditor({ radio }: Props) {
  const memories = useAppStore((s) => s.openRadio?.memories ?? []);
  const validationErrors = useAppStore(
    (s) => s.openRadio?.validationErrors ?? {},
  );
  const updateMemory = useAppStore((s) => s.updateMemory);
  const setValidationErrors = useAppStore((s) => s.setValidationErrors);
  const setMemoriesAction = useAppStore((s) => s.setMemories);

  const scrollRef = useRef<HTMLDivElement>(null);

  async function commit(updated: MemoryDict) {
    try {
      const errs = await runtime.setMemory(radio.info.handle, updated);
      setValidationErrors(updated.number, errs);
      if (errs.length === 0) {
        updateMemory(updated);
      }
    } catch (e) {
      // RPC-level failure (worker crash, etc.) — treat as a validation
      // error on this row so the user sees it instead of a silent no-op.
      setValidationErrors(updated.number, [errMsg(e)]);
    }
  }

  async function eraseRow(number: number) {
    await runtime.eraseMemory(radio.info.handle, number);
    const fresh = await runtime.getMemory(radio.info.handle, number);
    updateMemory(fresh);
  }

  const columns = useMemo<ColumnDef<MemoryDict>[]>(
    () => buildColumns(radio, commit, eraseRow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [radio.info.handle, radio.info.validModes.join(","), radio.info.validDuplexes.join(",")],
  );

  const table = useReactTable({
    data: memories,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.number),
  });

  const rowVirtualizer = useVirtualizer({
    count: memories.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0);

  return (
    <div className="memory-grid">
      <div className="grid-scroll" ref={scrollRef}>
        <table>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className={`col-${h.column.id}`}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr style={{ height: paddingTop }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {virtualRows.map((vr) => {
              const row = table.getRowModel().rows[vr.index];
              const m = row.original;
              const hasErr = (validationErrors[m.number]?.length ?? 0) > 0;
              const rowClass =
                (m.empty ? "empty " : "") + (hasErr ? "row-err" : "");
              return (
                <tr
                  key={row.id}
                  className={rowClass}
                  style={{ height: 34 }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`col-${cell.column.id}`}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr style={{ height: paddingBottom }}>
                <td colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ValidationFooter errors={validationErrors} />
    </div>
  );
}

function ValidationFooter({
  errors,
}: {
  errors: Record<number, string[]>;
}) {
  const rows = Object.entries(errors).filter(([, msgs]) => msgs.length > 0);
  if (rows.length === 0) return null;
  return (
    <div
      role="alert"
      style={{
        borderTop: "1px solid var(--danger, #b00)",
        background: "var(--danger-bg, #3a0d0d)",
        color: "var(--danger-fg, #ffd4d4)",
        padding: "0.5rem 0.75rem",
        fontSize: "0.82rem",
        maxHeight: "8rem",
        overflowY: "auto",
      }}
    >
      {rows.map(([num, msgs]) => (
        <div key={num}>
          <strong>#{num}:</strong> {msgs.join("; ")}
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- columns

function buildColumns(
  radio: Props["radio"],
  commit: (m: MemoryDict) => void,
  eraseRow: (n: number) => void,
): ColumnDef<MemoryDict>[] {
  return [
    {
      id: "number",
      header: "#",
      accessorKey: "number",
      cell: ({ row }) => (
        <span style={{ padding: "0 0.6rem" }}>{row.original.number}</span>
      ),
    },
    {
      id: "freq",
      header: "Frekans (MHz)",
      cell: ({ row }) => (
        <FreqCell
          value={row.original.freq}
          onChange={(freq) => {
            if (freq === null) return;
            commit({ ...row.original, freq, empty: freq === 0 });
          }}
        />
      ),
    },
    {
      id: "name",
      header: "Ad",
      cell: ({ row }) => (
        <TextCell
          value={row.original.name ?? ""}
          maxLength={getNameLen(radio)}
          onChange={(name) => commit({ ...row.original, name })}
        />
      ),
    },
    {
      id: "mode",
      header: "Mod",
      cell: ({ row }) => (
        <SelectCell
          value={row.original.mode ?? ""}
          options={radio.info.validModes}
          onChange={(mode) => commit({ ...row.original, mode })}
        />
      ),
    },
    {
      id: "duplex",
      header: "Duplex",
      cell: ({ row }) => (
        <SelectCell
          value={row.original.duplex ?? ""}
          options={radio.info.validDuplexes}
          onChange={(duplex) => commit({ ...row.original, duplex })}
        />
      ),
    },
    {
      id: "offset",
      header: "Offset (MHz)",
      cell: ({ row }) => (
        <FreqCell
          value={row.original.offset}
          onChange={(offset) => {
            if (offset === null) return;
            commit({ ...row.original, offset });
          }}
        />
      ),
    },
    {
      id: "tone",
      header: "Tone Mode",
      cell: ({ row }) => (
        <SelectCell
          value={row.original.tmode ?? ""}
          options={radio.info.validTmodes}
          onChange={(tmode) => commit({ ...row.original, tmode })}
        />
      ),
    },
    {
      id: "power",
      header: "Güç",
      cell: ({ row }) => {
        const opts = ["", ...radio.info.validPowerLevels];
        return (
          <SelectCell
            value={row.original.power ?? ""}
            options={opts}
            onChange={(power) =>
              commit({ ...row.original, power: power || null })
            }
          />
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          title="Bu kanalı sil"
          onClick={() => eraseRow(row.original.number)}
        >
          Sil
        </button>
      ),
    },
  ];
}

function getNameLen(radio: Props["radio"]): number {
  // We don't surface this from the API yet; default to a roomy value.
  return radio.info.hasName ? 16 : 0;
}

// --------------------------------------------------------------- cells

function FreqCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      className="cell-input"
      defaultValue={formatMHz(value)}
      onBlur={(e) => {
        const parsed = parseMHz(e.target.value);
        if (parsed !== null && parsed !== value) onChange(parsed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function TextCell({
  value,
  maxLength,
  onChange,
}: {
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className="cell-input"
      defaultValue={value}
      maxLength={maxLength || undefined}
      onBlur={(e) => {
        if (e.target.value !== value) onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function SelectCell({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="cell-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}
