import { useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { Task } from "@/types/api";

const COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
];

function parseTaskDate(dateStr: string): Date {
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6)) - 1;
  const day = parseInt(dateStr.slice(6, 8));
  return new Date(year, month, day);
}

function formatDateShort(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
}

function ChartCard({ title, children }: ChartCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

interface VelocityChartProps {
  tasks: Task[];
}

export function VelocityChart({ tasks }: VelocityChartProps) {
  const weeklyData = useMemo(() => {
    const weeks: Record<string, number> = {};
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - i * 7);
      const weekKey = `W${Math.ceil((weekStart.getDate()) / 7)}`;
      weeks[weekKey] = 0;
    }

    for (const task of tasks) {
      if (task.end) {
        const endDate = parseTaskDate(task.end);
        const weeksAgo = Math.floor((now.getTime() - endDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weeksAgo >= 0 && weeksAgo < 12) {
          const weekKey = Object.keys(weeks)[11 - weeksAgo];
          if (weekKey) weeks[weekKey]++;
        }
      }
    }

    return Object.entries(weeks).map(([week, count]) => ({ week, count }));
  }, [tasks]);

  return (
    <ChartCard title="Weekly Velocity">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeklyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="week" tick={{ fill: "#9ca3af", fontSize: 12 }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "0.5rem",
                color: "#f3f4f6",
              }}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

interface ProjectBreakdownProps {
  tasks: Task[];
}

export function ProjectBreakdown({ tasks }: ProjectBreakdownProps) {
  const projectData = useMemo(() => {
    const projects: Record<string, number> = {};

    for (const task of tasks) {
      if (task.status === "pending") {
        const project = task.project || "(none)";
        projects[project] = (projects[project] || 0) + 1;
      }
    }

    return Object.entries(projects)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));
  }, [tasks]);

  if (projectData.length === 0) {
    return (
      <ChartCard title="Tasks by Project">
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          No pending tasks
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Tasks by Project">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={projectData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              dataKey="value"
              label={({ name, value, x, y }) => (
                <text x={x} y={y} fill="#9ca3af" fontSize={11} textAnchor="middle">
                  {`${name}: ${value}`}
                </text>
              )}
              labelLine={false}
            >
              {projectData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "0.5rem",
                color: "#f3f4f6",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

interface TagDistributionProps {
  tasks: Task[];
}

export function TagDistribution({ tasks }: TagDistributionProps) {
  const tagData = useMemo(() => {
    const tags: Record<string, number> = {};

    for (const task of tasks) {
      if (task.status === "pending") {
        for (const tag of task.tags) {
          tags[tag] = (tags[tag] || 0) + 1;
        }
      }
    }

    return Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  }, [tasks]);

  if (tagData.length === 0) {
    return (
      <ChartCard title="Tasks by Tag">
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          No tagged tasks
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Tasks by Tag">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tagData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 12 }} />
            <YAxis dataKey="name" type="category" width={80} tick={{ fill: "#9ca3af", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "0.5rem",
                color: "#f3f4f6",
              }}
            />
            <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

interface BurndownChartProps {
  tasks: Task[];
}

export function BurndownChart({ tasks }: BurndownChartProps) {
  const burndownData = useMemo(() => {
    const days: { date: string; pending: number; completed: number }[] = [];
    const now = new Date();

    const tasksByDate: Record<string, { added: number; completed: number }> = {};

    for (const task of tasks) {
      const entryDate = parseTaskDate(task.entry);
      const entryKey = entryDate.toISOString().split("T")[0];
      if (!tasksByDate[entryKey]) tasksByDate[entryKey] = { added: 0, completed: 0 };
      tasksByDate[entryKey].added++;

      if (task.end) {
        const endDate = parseTaskDate(task.end);
        const endKey = endDate.toISOString().split("T")[0];
        if (!tasksByDate[endKey]) tasksByDate[endKey] = { added: 0, completed: 0 };
        tasksByDate[endKey].completed++;
      }
    }

    let runningPending = 0;
    let runningCompleted = 0;

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split("T")[0];

      if (tasksByDate[dateKey]) {
        runningPending += tasksByDate[dateKey].added - tasksByDate[dateKey].completed;
        runningCompleted += tasksByDate[dateKey].completed;
      }

      days.push({
        date: formatDateShort(date),
        pending: Math.max(0, runningPending),
        completed: runningCompleted,
      });
    }

    return days;
  }, [tasks]);

  return (
    <ChartCard title="30-Day Burndown">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={burndownData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "0.5rem",
                color: "#f3f4f6",
              }}
            />
            <Legend wrapperStyle={{ color: "#9ca3af" }} />
            <Area type="monotone" dataKey="pending" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
            <Area type="monotone" dataKey="completed" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

interface CalendarHeatmapProps {
  tasks: Task[];
}

export function CalendarHeatmap({ tasks }: CalendarHeatmapProps) {
  const heatmapData = useMemo(() => {
    const completionsByDate: Record<string, number> = {};

    for (const task of tasks) {
      if (task.end) {
        const endDate = parseTaskDate(task.end);
        const dateKey = endDate.toISOString().split("T")[0];
        completionsByDate[dateKey] = (completionsByDate[dateKey] || 0) + 1;
      }
    }

    const weeks: { week: number; days: { date: string; count: number; dayOfWeek: number }[] }[] = [];
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 364);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    let currentWeek: { date: string; count: number; dayOfWeek: number }[] = [];
    let weekNum = 0;

    for (let i = 0; i <= 370; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      if (date > now) break;

      const dateKey = date.toISOString().split("T")[0];
      const dayOfWeek = date.getDay();

      if (dayOfWeek === 0 && currentWeek.length > 0) {
        weeks.push({ week: weekNum++, days: currentWeek });
        currentWeek = [];
      }

      currentWeek.push({
        date: dateKey,
        count: completionsByDate[dateKey] || 0,
        dayOfWeek,
      });
    }

    if (currentWeek.length > 0) {
      weeks.push({ week: weekNum, days: currentWeek });
    }

    return weeks;
  }, [tasks]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const week of heatmapData) {
      for (const day of week.days) {
        if (day.count > max) max = day.count;
      }
    }
    return max || 1;
  }, [heatmapData]);

  const getColor = (count: number) => {
    if (count === 0) return "#374151";
    const intensity = Math.min(count / maxCount, 1);
    if (intensity < 0.25) return "#166534";
    if (intensity < 0.5) return "#16a34a";
    if (intensity < 0.75) return "#22c55e";
    return "#4ade80";
  };

  return (
    <ChartCard title="Completion Activity (Year)">
      <div className="overflow-x-auto">
        <div className="flex gap-0.5" style={{ minWidth: "max-content" }}>
          {heatmapData.map((week) => (
            <div key={week.week} className="flex flex-col gap-0.5">
              {week.days.map((day) => (
                <div
                  key={day.date}
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: getColor(day.count) }}
                  title={`${day.date}: ${day.count} completed`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Less</span>
        <div className="flex gap-0.5">
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#374151" }} />
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#166534" }} />
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#16a34a" }} />
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#22c55e" }} />
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#4ade80" }} />
        </div>
        <span>More</span>
      </div>
    </ChartCard>
  );
}

interface TaskAnalyticsProps {
  tasks: Task[];
}

export function TaskAnalytics({ tasks }: TaskAnalyticsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <BurndownChart tasks={tasks} />
      <VelocityChart tasks={tasks} />
      <ProjectBreakdown tasks={tasks} />
      <TagDistribution tasks={tasks} />
      <div className="md:col-span-2">
        <CalendarHeatmap tasks={tasks} />
      </div>
    </div>
  );
}
