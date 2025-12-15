import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { 
  RefreshCw, Trash2, Home, Activity, XCircle, 
  Clock, HardDrive, Cpu, Globe, TrendingUp, Image as ImageIcon,
  BarChart3, LineChart, PieChart
} from 'lucide-react';
import {
  BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart
} from 'recharts';

interface RenderMetric {
  id: string;
  type: 'image' | 'video';
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  fileSize: number;
  meshCount?: number;
  error?: string;
}

interface MetricsData {
  timestamp: number;
  renderMetrics: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    activeRenders: number;
    avgProcessingTime: number;
    recentRenders: RenderMetric[];
  };
  browserStatus: {
    initialized: boolean;
    activeBrowsers: number;
    browsers: Array<{ id: string; uptime: number }>;
  };
  systemMetrics: {
    memory: {
      total: number;
      free: number;
      used: number;
      usagePercent: number;
    };
    cpu: {
      cores: number;
      model: string;
      loadAvg: number[];
    };
    uptime: number;
    platform: string;
    nodeVersion: string;
  };
}

interface AnalyticsData {
  timeline: Array<{ hour: string; renders: number; avgDuration: number }>;
  performance: {
    avgDuration: number;
    p50: number;
    p95: number;
    p99: number;
    fastest: number;
    slowest: number;
  };
  distribution: {
    byType: Array<{ type: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  outliers: Array<{
    id: string;
    duration_ms: number;
    file_size_bytes: number;
    thumbnail_hash?: string;
  }>;
  topFiles: Array<{ hash: string; count: number; avgDuration: number }>;
}

export function AdminDashboard() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [activeRenders, setActiveRenders] = useState<RenderMetric[]>([]);
  const [renderHistory, setRenderHistory] = useState<RenderMetric[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/admin/metrics');
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setMetrics(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching metrics:', err);
    }
  };

  const fetchActiveRenders = async () => {
    try {
      const response = await fetch('/api/admin/active-renders');
      if (!response.ok) throw new Error('Failed to fetch active renders');
      const data = await response.json();
      setActiveRenders(data.activeRenders);
    } catch (err: any) {
      console.error('Error fetching active renders:', err);
    }
  };

  const fetchRenderHistory = async () => {
    try {
      const response = await fetch('/api/admin/render-history?limit=20');
      if (!response.ok) throw new Error('Failed to fetch render history');
      const data = await response.json();
      setRenderHistory(data.renders);
    } catch (err: any) {
      console.error('Error fetching render history:', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const [timeline, performance, distribution, outliers, topFiles] = await Promise.all([
        fetch('/api/analytics/timeline?hours=24').then(r => r.json()),
        fetch('/api/analytics/performance').then(r => r.json()),
        fetch('/api/analytics/distribution').then(r => r.json()),
        fetch('/api/analytics/outliers?limit=12').then(r => r.json()),
        fetch('/api/analytics/top-files?limit=10').then(r => r.json()),
      ]);

      setAnalytics({
        timeline: timeline.data || [],
        performance: performance.data || {},
        distribution: {
          byType: distribution.byType || [],
          byStatus: distribution.byStatus || [],
        },
        outliers: outliers.renders || [],
        topFiles: topFiles.files || [],
      });
    } catch (err: any) {
      console.error('Error fetching analytics:', err);
    }
  };

  const resetMetrics = async () => {
    if (!confirm('Are you sure you want to reset all metrics?')) return;
    
    try {
      const response = await fetch('/api/admin/reset-metrics', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset metrics');
      await fetchAllData();
    } catch (err: any) {
      alert('Error resetting metrics: ' + err.message);
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      fetchMetrics(),
      fetchActiveRenders(),
      fetchRenderHistory(),
      fetchAnalytics(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchAllData, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive'; label: string }> = {
      running: { variant: 'default', label: 'Running' },
      completed: { variant: 'secondary', label: 'Completed' },
      error: { variant: 'destructive', label: 'Error' },
    };
    const config = variants[status] || variants.running;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (loading && !metrics) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-muted-foreground">Real-time monitoring and metrics for Schemat Render</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-input"
              />
              Auto-refresh (2s)
            </label>
            <Button onClick={fetchAllData} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={resetMetrics} variant="destructive" size="sm">
              <Trash2 className="h-4 w-4" />
              Reset
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/">
                <Home className="h-4 w-4" />
                Renderer
              </a>
            </Button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">Error: {error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {metrics && (
          <>
            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Renders</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.renderMetrics.total}</div>
                  <p className="text-xs text-muted-foreground">All time renders</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.renderMetrics.successRate.toFixed(1)}%</div>
                  <p className="text-xs text-muted-foreground">
                    {metrics.renderMetrics.successful} successful, {metrics.renderMetrics.failed} failed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Renders</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.renderMetrics.activeRenders}</div>
                  <p className="text-xs text-muted-foreground">Currently processing</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Time</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatDuration(metrics.renderMetrics.avgProcessingTime)}</div>
                  <p className="text-xs text-muted-foreground">Per render</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Browsers</CardTitle>
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.browserStatus.activeBrowsers}</div>
                  <p className="text-xs text-muted-foreground">Browser instances</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.systemMetrics.memory.usagePercent}%</div>
                  <p className="text-xs text-muted-foreground">
                    {metrics.systemMetrics.memory.used} / {metrics.systemMetrics.memory.total} MB
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">CPU Cores</CardTitle>
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.systemMetrics.cpu.cores}</div>
                  <p className="text-xs text-muted-foreground">Available cores</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatUptime(metrics.systemMetrics.uptime)}</div>
                  <p className="text-xs text-muted-foreground">System uptime</p>
                </CardContent>
              </Card>
            </div>

            {/* Performance Charts */}
            {analytics && (
              <>
                {/* Timeline Chart */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <LineChart className="h-5 w-5" />
                        Render Timeline (24h)
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={analytics.timeline}>
                        <defs>
                          <linearGradient id="colorRenders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorDuration" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#82ca9d" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="hour" className="text-xs" />
                        <YAxis yAxisId="left" className="text-xs" />
                        <YAxis yAxisId="right" orientation="right" className="text-xs" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend />
                        <Area yAxisId="left" type="monotone" dataKey="renders" stroke="#8884d8" fillOpacity={1} fill="url(#colorRenders)" name="Renders" />
                        <Area yAxisId="right" type="monotone" dataKey="avgDuration" stroke="#82ca9d" fillOpacity={1} fill="url(#colorDuration)" name="Avg Duration (ms)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Performance Metrics & Distribution */}
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Performance Percentiles */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Performance Percentiles
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={[
                          { name: 'Fastest', value: analytics.performance.fastest },
                          { name: 'P50', value: analytics.performance.p50 },
                          { name: 'P95', value: analytics.performance.p95 },
                          { name: 'P99', value: analytics.performance.p99 },
                          { name: 'Slowest', value: analytics.performance.slowest },
                        ]}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="name" className="text-xs" />
                          <YAxis className="text-xs" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                            formatter={(value: number | undefined) => value ? `${value}ms` : 'N/A'}
                          />
                          <Bar dataKey="value" fill="#8884d8" />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Status Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <PieChart className="h-5 w-5" />
                        Status Distribution
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <RechartsPie>
                          <Pie
                            data={analytics.distribution.byStatus}
                            dataKey="count"
                            nameKey="status"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            label
                          >
                            {analytics.distribution.byStatus.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={
                                entry.status === 'completed' ? '#82ca9d' : 
                                entry.status === 'failed' ? '#ff6b6b' : 
                                '#8884d8'
                              } />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                          />
                          <Legend />
                        </RechartsPie>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>

                {/* Thumbnail Viewer - Outliers */}
                {analytics.outliers.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <ImageIcon className="h-5 w-5" />
                        Slowest Renders (Outliers)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                        {analytics.outliers.map((outlier) => (
                          <div key={outlier.id} className="group relative">
                            <div className="aspect-square rounded-lg overflow-hidden bg-muted border border-border hover:border-primary transition-colors">
                              {outlier.thumbnail_hash ? (
                                <img 
                                  src={`/api/analytics/thumbnail/${outlier.thumbnail_hash}`}
                                  alt={`Render ${outlier.id.substring(0, 8)}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon class="h-8 w-8" /></div>';
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                  <ImageIcon className="h-8 w-8" />
                                </div>
                              )}
                            </div>
                            <div className="mt-2 space-y-1">
                              <p className="text-xs font-mono text-muted-foreground truncate">
                                {outlier.id.substring(0, 12)}
                              </p>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">
                                  {formatDuration(outlier.duration_ms)}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatBytes(outlier.file_size_bytes)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {/* System Information */}
            <Card>
              <CardHeader>
                <CardTitle>System Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Platform</p>
                    <p className="text-sm font-medium">{metrics.systemMetrics.platform}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Node Version</p>
                    <p className="text-sm font-medium">{metrics.systemMetrics.nodeVersion}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">CPU Model</p>
                    <p className="text-sm font-medium truncate">{metrics.systemMetrics.cpu.model}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Load Average</p>
                    <p className="text-sm font-medium">
                      {metrics.systemMetrics.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Total Memory</p>
                    <p className="text-sm font-medium">{metrics.systemMetrics.memory.total} MB</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Free Memory</p>
                    <p className="text-sm font-medium">{metrics.systemMetrics.memory.free} MB</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Active Renders */}
            {activeRenders.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Active Renders ({activeRenders.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium">ID</th>
                          <th className="text-left p-2 font-medium">Type</th>
                          <th className="text-left p-2 font-medium">Status</th>
                          <th className="text-left p-2 font-medium">File Size</th>
                          <th className="text-left p-2 font-medium">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeRenders.map((render) => (
                          <tr key={render.id} className="border-b">
                            <td className="p-2">
                              <code className="text-xs bg-muted px-2 py-1 rounded">
                                {render.id.substring(0, 20)}...
                              </code>
                            </td>
                            <td className="p-2">
                              <Badge variant="outline">{render.type}</Badge>
                            </td>
                            <td className="p-2">{getStatusBadge(render.status)}</td>
                            <td className="p-2">{formatBytes(render.fileSize)}</td>
                            <td className="p-2">{formatDuration(Date.now() - render.startTime)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Render History */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Render History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">ID</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="text-left p-2 font-medium">File Size</th>
                        <th className="text-left p-2 font-medium">Meshes</th>
                        <th className="text-left p-2 font-medium">Duration</th>
                        <th className="text-left p-2 font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderHistory.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center p-8 text-muted-foreground">
                            No render history yet
                          </td>
                        </tr>
                      ) : (
                        renderHistory.map((render) => (
                          <tr key={render.id} className="border-b hover:bg-muted/50">
                            <td className="p-2">
                              <code className="text-xs bg-muted px-2 py-1 rounded">
                                {render.id.substring(0, 20)}...
                              </code>
                            </td>
                            <td className="p-2">
                              <Badge variant="outline">{render.type}</Badge>
                            </td>
                            <td className="p-2">{getStatusBadge(render.status)}</td>
                            <td className="p-2">{formatBytes(render.fileSize)}</td>
                            <td className="p-2">{render.meshCount || 'N/A'}</td>
                            <td className="p-2">{formatDuration(render.duration)}</td>
                            <td className="p-2 text-muted-foreground">
                              {new Date(render.startTime).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;
