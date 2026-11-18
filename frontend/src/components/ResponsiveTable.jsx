// components/ResponsiveTable.jsx
//
// A normal table on tablets/laptops; a clean list of cards on phones.
//
// <ResponsiveTable
//   columns={[
//     { key: "admission_no", label: "Adm No", mono: true },
//     { key: "name", label: "Student", primary: true },          // card title
//     { key: "class_name", label: "Class" },
//     { key: "balance", label: "Balance", align: "right", mono: true,
//       render: (row) => `KES ${row.balance.toLocaleString()}` },
//     { key: "status", label: "Status", badge: true,
//       render: (row) => <span className="badge badge-success">Paid</span> },
//   ]}
//   rows={students}
//   rowKey="id"
//   onRowClick={(row) => navigate(`/students/${row.id}`)}
//   actions={(row) => <button className="btn btn-sm btn-outline-primary">View</button>}
//   loading={loading}
//   emptyText="No students found"
// />
import { useDevice } from "../hooks/useDevice";

function cellValue(col, row) {
  if (col.render) return col.render(row);
  const v = row[col.key];
  return v === null || v === undefined || v === "" ? "—" : v;
}

export default function ResponsiveTable({
  columns,
  rows = [],
  rowKey = "id",
  onRowClick,
  actions,
  loading = false,
  emptyText = "Nothing to show yet",
  className = "",
}) {
  const { isPhone } = useDevice();

  const keyOf = (row, i) => (typeof rowKey === "function" ? rowKey(row) : row[rowKey] ?? i);

  if (loading) {
    return (
      <div className="page-loader page-loader--inline">
        <div className="page-loader__ring" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-inbox" aria-hidden="true"></i>
        <h6>{emptyText}</h6>
      </div>
    );
  }

  /* ---------- PHONE: cards ---------- */
  if (isPhone) {
    const primary = columns.find((c) => c.primary) || columns[0];
    const rest = columns.filter((c) => c !== primary);

    return (
      <div className={`m-card-list ${className}`}>
        {rows.map((row, i) => (
          <article
            key={keyOf(row, i)}
            className={`m-card${onRowClick ? " m-card--tappable" : ""}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? "button" : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (e) => (e.key === "Enter" || e.key === " ") && onRowClick(row)
                : undefined
            }
          >
            <header className="m-card__head">
              <div className="m-card__title">{cellValue(primary, row)}</div>
              {onRowClick && <i className="bi bi-chevron-right m-card__chev" aria-hidden="true"></i>}
            </header>

            <dl className="m-card__body">
              {rest.map((col) => (
                <div className="m-card__row" key={col.key}>
                  <dt>{col.label}</dt>
                  <dd className={col.mono ? "font-mono" : undefined}>{cellValue(col, row)}</dd>
                </div>
              ))}
            </dl>

            {actions && (
              <footer className="m-card__actions" onClick={(e) => e.stopPropagation()}>
                {actions(row)}
              </footer>
            )}
          </article>
        ))}
      </div>
    );
  }

  /* ---------- TABLET / LAPTOP: table ---------- */
  return (
    <div className={`table-wrap ${className}`}>
      <div className="table-responsive">
        <table className="table table-hover">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.label}
                </th>
              ))}
              {actions && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={[c.mono ? "cell-mono" : "", c.primary ? "cell-name" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    style={c.align ? { textAlign: c.align } : undefined}
                  >
                    {cellValue(c, row)}
                  </td>
                ))}
                {actions && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="table-actions">{actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}