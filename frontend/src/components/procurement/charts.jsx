import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export const PALETTE = ["#2563eb", "#0d9488", "#f59e0b", "#e11d48", "#7c3aed", "#0891b2", "#65a30d", "#ea580c"];
const short = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${n}`);
const label = (s) => String(s).replaceAll("_", " ").toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase());

export function ChartCard({ title, subtitle, height = 260, empty, children, className = "" }) {
  return (
    <div className={`chart-card ${className}`.trim()}>
      <div className="chart-card__header">
        <div>
          <div className="chart-card__title">{title}</div>
          {subtitle && <div className="chart-card__subtitle">{subtitle}</div>}
        </div>
      </div>
      <div style={{ height }} className="mt-2">
        {empty ? (
          <div className="empty-state h-100 d-flex flex-column justify-content-center">
            <i className="bi bi-bar-chart"></i>
            <p className="text-muted-soft mb-0">No data yet</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** bars=[{key,name,color}] ; horizontal for long labels ; money formats ticks as 12k / 1.2M */
export function BarCard({ title, subtitle, data = [], xKey = "name", bars, horizontal, stacked, money, height }) {
  const series = bars || [{ key: "value", name: "Value" }];
  const fmt = money ? short : undefined;
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!data.length}>
      <ResponsiveContainer>
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 24 : 0, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={!horizontal} horizontal={horizontal ? false : true} />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={fmt} />
              <YAxis type="category" dataKey={xKey} width={110} tick={{ fontSize: 11 }} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmt} />
            </>
          )}
          <Tooltip formatter={(v) => (money ? `KES ${Number(v).toLocaleString()}` : v)} />
          {series.length > 1 && <Legend />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color || PALETTE[i]} stackId={stacked ? "a" : undefined} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AreaCard({ title, subtitle, data = [], xKey = "month", lines, money, height }) {
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!data.length}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ right: 12 }}>
          <defs>
            {lines.map((l, i) => (
              <linearGradient id={`g-${l.key}`} key={l.key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={l.color || PALETTE[i]} stopOpacity={0.35} />
                <stop offset="95%" stopColor={l.color || PALETTE[i]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={money ? short : undefined} />
          <Tooltip formatter={(v) => (money ? `KES ${Number(v).toLocaleString()}` : v)} />
          <Legend />
          {lines.map((l, i) => (
            <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color || PALETTE[i]} fill={`url(#g-${l.key})`} strokeWidth={2} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function LineCard({ title, subtitle, data = [], xKey = "name", lines, height }) {
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!data.length}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} /><YAxis /><Tooltip /><Legend />
          {lines.map((l, i) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color || PALETTE[i]} strokeWidth={2} dot={{ r: 3 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DonutCard({ title, subtitle, data = [], money, height }) {
  const rows = data.filter((d) => Number(d.value) > 0).map((d) => ({ ...d, name: label(d.name) }));
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!rows.length}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
            {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => (money ? `KES ${Number(v).toLocaleString()}` : v)} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// helper: [{status:"A"},{status:"B"},{status:"A"}] -> [{name:"A",value:2},{name:"B",value:1}]
export const countBy = (rows, key) => {
  const m = {};
  rows.forEach((r) => { m[r[key] || "—"] = (m[r[key] || "—"] || 0) + 1; });
  return Object.entries(m).map(([name, value]) => ({ name, value }));
};
export const sumBy = (rows, key, valueKey, top = 8) => {
  const m = {};
  rows.forEach((r) => { m[r[key] || "—"] = (m[r[key] || "—"] || 0) + Number(r[valueKey] || 0); });
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, top);
};