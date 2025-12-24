import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import {
  RefreshCw, Trash2, Home, Activity, XCircle, Clock, Globe,
  TrendingUp, Image as ImageIcon, BarChart3, LineChart, PieChart, Database,
  FileText, Search, Zap, Server,
  Layers, ChevronLeft, ChevronRight, Package, Download, CheckCircle, Lock, LogOut
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

interface PuppeteerMetrics {
  initialized: boolean;
  activeBrowsers: number;
  totalPages: number;
  browserMemoryUsage: number;
  browserPerformance: Array<{
    id: string;
    uptime: number;
    pageCount: number;
    performance: {
      jsHeapSizeUsed: number;
      jsHeapTotalSize: number;
      jsHeapSizeLimit: number;
      tasks: number;
      layouts: number;
      recalculates: number;
    } | null;
  }>;
  systemResources: {
    nodeVersion: string;
    platform: string;
    architecture: string;
    uptime: number;
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

interface Schema {
  file_hash: string;
  original_filename: string | null;
  file_size: number;
  mime_type: string | null;
  block_count: number | null;
  dimensions_x: number | null;
  dimensions_y: number | null;
  dimensions_z: number | null;
  access_count: number;
  last_accessed: number | null;
  created_at: number;
  render_count: number;
  successful_renders: number;
  failed_renders: number;
  avg_render_duration: number | null;
  fastest_render: number | null;
  slowest_render: number | null;
  last_rendered_at: number | null;
}

interface InsightsData {
  overall: {
    total_renders: number;
    unique_schemas: number;
    successful_renders: number;
    failed_renders: number;
    avg_duration: number;
    total_data_processed: number;
  };
  hourly: Array<{
    hour: string;
    renders: number;
    unique_schemas: number;
    avg_duration: number;
  }>;
  bySource: Array<{
    source: string;
    count: number;
    avg_duration: number;
  }>;
  bySize: Array<{
    size_range: string;
    count: number;
  }>;
}

interface BatchJob {
  id: string;
  userId: string;
  totalSchematics: number;
  succeeded: number;
  failed: number;
  cached: number;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  resultFileSize?: number;
  downloadUrl?: string;
  sourceDownloadUrl?: string;
  errorMessage?: string;
  createdAt: number;
  options?: {
    width: number;
    height: number;
    isometric: boolean;
    background: string;
    framing: string;
  };
}

interface BatchItem {
  id: string;
  fileHash: string;
  filename: string;
  status: 'pending' | 'cached' | 'rendered' | 'failed';
  renderId?: string;
  cachedRenderId?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  errorMessage?: string;
}

interface BatchStats {
  period: string;
  since: string;
  stats: {
    totalBatches: number;
    completedBatches: number;
    runningBatches: number;
    failedBatches: number;
    totalSchematicsProcessed: number;
    totalSucceeded: number;
    totalFailed: number;
    totalCached: number;
    avgDuration: number;
    avgSuccessRate: number;
  };
}

// Thumbnail component with error handling
function ThumbnailImage({ fileHash, filename }: { fileHash: string; filename: string }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={`/api/analytics/thumbnail/${fileHash}`}
      alt={filename}
      className="w-full h-full object-cover"
      onError={() => setHasError(true)}
    />
  );
}

export function AdminDashboard() {
  const [password, setPassword] = useState(localStorage.getItem('admin_password') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('admin_password'));
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [activeRenders, setActiveRenders] = useState<RenderMetric[]>([]);
  const [renderHistory, setRenderHistory] = useState<RenderMetric[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [puppeteerMetrics, setPuppeteerMetrics] = useState<PuppeteerMetrics | null>(null);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [schemasTotal, setSchemasTotal] = useState(0);
  const [schemasPage, setSchemasPage] = useState(0);
  const [schemasSearch, setSchemasSearch] = useState('');
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [batchStats, setBatchStats] = useState<BatchStats | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<BatchJob | null>(null);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const SCHEMAS_PER_PAGE = 24;

  const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${password}`,
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      setIsLoggedIn(false);
      localStorage.removeItem('admin_password');
      throw new Error('Unauthorized');
    }
    return response;
  }, [password]);

  const fetchMetrics = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/metrics');
      const data = await response.json();
      setMetrics(data);
      setError(null);
    } catch (err: any) {
      if (err.message !== 'Unauthorized') {
        setError(err.message);
        console.error('Error fetching metrics:', err);
      }
    }
  };

  const fetchActiveRenders = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/active-renders');
      const data = await response.json();
      setActiveRenders(data.activeRenders);
    } catch (err: any) {
      console.error('Error fetching active renders:', err);
    }
  };

  const fetchRenderHistory = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/render-history?limit=50');
      const data = await response.json();
      setRenderHistory(data.renders);
    } catch (err: any) {
      console.error('Error fetching render history:', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const [timeline, performance, distribution, outliers, topFiles] = await Promise.all([
        authenticatedFetch('/api/analytics/timeline?hours=24').then(r => r.json()).catch(() => ({ data: [] })),
        authenticatedFetch('/api/analytics/performance').then(r => r.json()).catch(() => ({ data: {} })),
        authenticatedFetch('/api/analytics/distribution').then(r => r.json()).catch(() => ({ byType: [], byStatus: [] })),
        authenticatedFetch('/api/analytics/outliers?limit=12').then(r => r.json()).catch(() => ({ renders: [] })),
        authenticatedFetch('/api/analytics/top-files?limit=10').then(r => r.json()).catch(() => ({ files: [] })),
      ]);

      setAnalytics({
        timeline: timeline.data || [],
        performance: performance.data || {
          avgDuration: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          fastest: 0,
          slowest: 0,
        },
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

  const fetchInsights = async () => {
    try {
      const response = await authenticatedFetch('/api/analytics/insights?hours=24');
      const data = await response.json();
      setInsights(data);
    } catch (err: any) {
      console.error('Error fetching insights:', err);
    }
  };

  const fetchSchemas = async () => {
    try {
      const offset = schemasPage * SCHEMAS_PER_PAGE;
      const response = await authenticatedFetch(`/api/admin/schemas?limit=${SCHEMAS_PER_PAGE}&offset=${offset}&sortBy=created_at&sortOrder=DESC`);
      const data = await response.json();
      setSchemas(data.schemas || []);
      setSchemasTotal(data.total || 0);
    } catch (err: any) {
      console.error('Error fetching schemas:', err);
    }
  };

  const fetchPuppeteerMetrics = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/puppeteer-metrics');
      const data = await response.json();
      setPuppeteerMetrics(data);
    } catch (err: any) {
      console.error('Error fetching Puppeteer metrics:', err);
    }
  };

  const fetchBatchJobs = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/batch-jobs?limit=100');
      const data = await response.json();
      setBatchJobs(data.batches || []);
    } catch (err: any) {
      console.error('Error fetching batch jobs:', err);
      setBatchJobs([]);
    }
  };

  const fetchBatchStats = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/batch-stats?days=30');
      const data = await response.json();
      setBatchStats(data);
    } catch (err: any) {
      console.error('Error fetching batch stats:', err);
    }
  };

  const fetchBatchDetails = async (batchId: string) => {
    try {
      const response = await authenticatedFetch(`/api/admin/batch-jobs/${batchId}`);
      const data = await response.json();
      setSelectedBatch(data.batch);
      setBatchItems(data.items || []);
    } catch (err: any) {
      console.error('Error fetching batch details:', err);
    }
  };

  const resetMetrics = async () => {
    if (!confirm('Are you sure you want to reset all metrics?')) return;

    try {
      const response = await authenticatedFetch('/api/admin/reset-metrics', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset metrics');
      await fetchAllData();
    } catch (err: any) {
      alert('Error resetting metrics: ' + err.message);
    }
  };

  const fetchAllData = async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    await Promise.all([
      fetchMetrics(),
      fetchActiveRenders(),
      fetchRenderHistory(),
      fetchAnalytics(),
      fetchPuppeteerMetrics(),
      fetchInsights(),
      fetchBatchJobs(),
      fetchBatchStats(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchAllData();
    }
    document.getElementById('root')!.classList.add('admin-dashboard');
    return () => {
      document.getElementById('root')!.classList.remove('admin-dashboard');
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchSchemas();
    }
  }, [schemasPage, isLoggedIn]);

  useEffect(() => {
    if (!autoRefresh || !isLoggedIn) return;

    let ws: WebSocket | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isConnecting = false;

    const connectWebSocket = () => {
      if (isConnecting || (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN))) {
        return;
      }

      isConnecting = true;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/admin`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        isConnecting = false;
        setError(null);
        if (fallbackInterval) {
          clearInterval(fallbackInterval);
          fallbackInterval = null;
        }
        // Send auth message if needed, but current server doesn't seem to support WS auth yet.
        // For simplicity, we'll keep WS as is or implement simple auth if server allows.
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'update' && message.data) {
            if (message.data.metrics) setMetrics(message.data.metrics);
            if (message.data.activeRenders) setActiveRenders(message.data.activeRenders.activeRenders || []);
            if (message.data.renderHistory) setRenderHistory(message.data.renderHistory.renders || []);
            if (message.data.analytics) setAnalytics(message.data.analytics);
            if (message.data.puppeteerMetrics) setPuppeteerMetrics(message.data.puppeteerMetrics);
            setLoading(false);
            setError(null);
          }
        } catch (err: any) {
          console.error('[WebSocket] Error parsing message:', err);
        }
      };

      ws.onerror = () => {
        isConnecting = false;
      };

      ws.onclose = (event) => {
        isConnecting = false;
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        if (autoRefresh && event.code !== 1000 && event.code !== 1001) {
          setError('WebSocket disconnected. Falling back to polling.');
          if (!fallbackInterval) {
            fallbackInterval = setInterval(fetchAllData, 2000);
          }
          reconnectTimeout = setTimeout(() => {
            if (autoRefresh && !isConnecting) {
              connectWebSocket();
            }
          }, 5000);
        }
      };

      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    connectWebSocket();

    return () => {
      if (pingInterval) clearInterval(pingInterval);
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Component unmounting');
        }
      }
    };
  }, [autoRefresh, isLoggedIn]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('admin_password', password);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_password');
    setPassword('');
    setIsLoggedIn(false);
  };

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

  const filteredSchemas = schemas.filter(schema => {
    if (!schemasSearch) return true;
    const search = schemasSearch.toLowerCase();
    return (
      schema.original_filename?.toLowerCase().includes(search) ||
      schema.file_hash.toLowerCase().includes(search)
    );
  });

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
        <Card className="w-full max-w-md shadow-xl border-t-4 border-t-primary">
          <CardHeader className="text-center">
            <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-4">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">Admin Access</CardTitle>
            <CardDescription>Enter your password to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="Admin Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border rounded-md bg-background focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Unlock Dashboard
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <a href="/">
                  <Home className="h-4 w-4 mr-2" />
                  Back to Renderer
                </a>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">Real-time monitoring and analytics for Schemat Render</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-input"
              />
              Auto-refresh
            </label>
            <Button onClick={fetchAllData} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={resetMetrics} variant="destructive" size="sm">
              <Trash2 className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={handleLogout} variant="ghost" size="sm">
              <LogOut className="h-4 w-4" />
              Logout
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="schemas">Schemas</TabsTrigger>
              <TabsTrigger value="batches">Batches</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="renders">Renders</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Key Metrics Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="border-l-4 border-l-blue-500">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Renders</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.renderMetrics.total}</div>
                    <p className="text-xs text-muted-foreground">All time renders</p>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-green-500">
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

                <Card className="border-l-4 border-l-yellow-500">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Renders</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.renderMetrics.activeRenders}</div>
                    <p className="text-xs text-muted-foreground">Currently processing</p>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-purple-500">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Time</CardTitle>
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatDuration(metrics.renderMetrics.avgProcessingTime)}</div>
                    <p className="text-xs text-muted-foreground">Per render</p>
                  </CardContent>
                </Card>
              </div>

              {/* System Health */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="h-5 w-5" />
                      System Resources
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Memory</span>
                        <span>{metrics.systemMetrics.memory.usagePercent}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${metrics.systemMetrics.memory.usagePercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {metrics.systemMetrics.memory.used} / {metrics.systemMetrics.memory.total} MB
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">CPU Cores</span>
                        <p className="font-medium">{metrics.systemMetrics.cpu.cores}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Uptime</span>
                        <p className="font-medium">{formatUptime(metrics.systemMetrics.uptime)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" />
                      Browser Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge variant={metrics.browserStatus.initialized ? 'secondary' : 'destructive'}>
                          {metrics.browserStatus.initialized ? 'Ready' : 'Initializing'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Active Browsers</span>
                        <span className="font-medium">{metrics.browserStatus.activeBrowsers}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {insights && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5" />
                        Data Insights
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Unique Schemas</span>
                        <span className="font-medium">{insights.overall.unique_schemas}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Data Processed</span>
                        <span className="font-medium">{formatBytes(insights.overall.total_data_processed || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">24h Renders</span>
                        <span className="font-medium">{insights.overall.total_renders}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Timeline Chart */}
              {analytics && analytics.timeline.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <LineChart className="h-5 w-5" />
                      Render Activity (24h)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={analytics.timeline}>
                        <defs>
                          <linearGradient id="colorRenders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="hour" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Area type="monotone" dataKey="renders" stroke="#8884d8" fillOpacity={1} fill="url(#colorRenders)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Schemas Tab */}
            <TabsContent value="schemas" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Layers className="h-5 w-5" />
                        Uploaded Schemas
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {schemasTotal} total schemas • {filteredSchemas.length} shown
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Search schemas..."
                          value={schemasSearch}
                          onChange={(e) => setSchemasSearch(e.target.value)}
                          className="pl-8 pr-4 py-2 text-sm border rounded-md bg-background"
                        />
                      </div>
                      <Button onClick={fetchSchemas} variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredSchemas.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No schemas found</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredSchemas.map((schema) => (
                          <Card key={schema.file_hash} className="hover:shadow-lg transition-shadow cursor-pointer">
                            <CardContent className="p-4">
                              <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-3 flex items-center justify-center">
                                {schema.file_hash ? (
                                  <img
                                    src={`/api/analytics/thumbnail/${schema.file_hash}`}
                                    alt={schema.original_filename || schema.file_hash}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <ImageIcon className="h-12 w-12 text-muted-foreground" />
                                )}
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <p className="font-medium text-sm truncate" title={schema.original_filename || schema.file_hash}>
                                    {schema.original_filename || schema.file_hash.substring(0, 16) + '...'}
                                  </p>
                                  <p className="text-xs text-muted-foreground font-mono truncate">
                                    {schema.file_hash.substring(0, 12)}...
                                  </p>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{formatBytes(schema.file_size)}</span>
                                  <Badge variant="outline">{schema.render_count} renders</Badge>
                                </div>
                                {schema.dimensions_x && (
                                  <div className="text-xs text-muted-foreground">
                                    {schema.dimensions_x} × {schema.dimensions_y} × {schema.dimensions_z}
                                  </div>
                                )}
                                <div className="flex items-center justify-between text-xs pt-1 border-t">
                                  <span className="text-muted-foreground">
                                    {schema.successful_renders} success, {schema.failed_renders} failed
                                  </span>
                                </div>
                                {schema.avg_render_duration && (
                                  <div className="text-xs text-muted-foreground">
                                    Avg: {formatDuration(schema.avg_render_duration)}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                      {schemasTotal > SCHEMAS_PER_PAGE && (
                        <div className="flex items-center justify-between mt-6">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSchemasPage(Math.max(0, schemasPage - 1))}
                            disabled={schemasPage === 0}
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {schemasPage + 1} of {Math.ceil(schemasTotal / SCHEMAS_PER_PAGE)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSchemasPage(schemasPage + 1)}
                            disabled={(schemasPage + 1) * SCHEMAS_PER_PAGE >= schemasTotal}
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Batches Tab */}
            <TabsContent value="batches" className="space-y-6 mt-6">
              {/* Batch Statistics */}
              {batchStats && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Batches</CardTitle>
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{batchStats.stats.totalBatches}</div>
                      <p className="text-xs text-muted-foreground">Last {batchStats.period}</p>
                    </CardContent>
                  </Card>

                  <Card className="border-l-4 border-l-green-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Completed</CardTitle>
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{batchStats.stats.completedBatches}</div>
                      <p className="text-xs text-muted-foreground">
                        {batchStats.stats.runningBatches} running, {batchStats.stats.failedBatches} failed
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="border-l-4 border-l-purple-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Schematics Processed</CardTitle>
                      <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{batchStats.stats.totalSchematicsProcessed}</div>
                      <p className="text-xs text-muted-foreground">
                        {batchStats.stats.totalSucceeded} succeeded, {batchStats.stats.totalCached} cached
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="border-l-4 border-l-yellow-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{batchStats.stats.avgSuccessRate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground">
                        Avg duration: {formatDuration(batchStats.stats.avgDuration)}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Batch Jobs List */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        Batch Jobs
                      </CardTitle>
                      <CardDescription>View and manage batch processing jobs</CardDescription>
                    </div>
                    <Button onClick={fetchBatchJobs} variant="outline" size="sm">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {batchJobs.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No batch jobs found</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {batchJobs.map((batch) => (
                        <Card
                          key={batch.id}
                          className={`hover:shadow-lg transition-shadow cursor-pointer ${selectedBatch?.id === batch.id ? 'ring-2 ring-primary' : ''
                            }`}
                          onClick={() => fetchBatchDetails(batch.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-4">
                              {/* Preview Thumbnail */}
                              <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                                {batch.status === 'completed' && batch.succeeded > 0 ? (
                                  <div className="relative w-full h-full">
                                    {/* Show first successful item thumbnail if available */}
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-500/20 to-blue-500/20">
                                      <CheckCircle className="h-8 w-8 text-green-600" />
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-1">
                                      {batch.succeeded}/{batch.totalSchematics}
                                    </div>
                                  </div>
                                ) : batch.status === 'error' ? (
                                  <div className="w-full h-full flex items-center justify-center bg-destructive/10">
                                    <XCircle className="h-8 w-8 text-destructive" />
                                  </div>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Clock className="h-8 w-8 text-muted-foreground animate-pulse" />
                                  </div>
                                )}
                              </div>

                              <div className="flex-1 space-y-2 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Badge variant={batch.status === 'completed' ? 'default' : batch.status === 'error' ? 'destructive' : 'secondary'}>
                                    {batch.status}
                                  </Badge>
                                  <span className="text-sm font-mono text-muted-foreground truncate">{batch.id.substring(0, 16)}...</span>
                                  {batch.downloadUrl && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const url = batch.downloadUrl!.startsWith('http')
                                          ? batch.downloadUrl
                                          : `${window.location.origin}${batch.downloadUrl}`;
                                        window.open(url, '_blank');
                                      }}
                                      className="ml-auto"
                                    >
                                      <Download className="h-4 w-4 mr-1" />
                                      Download
                                    </Button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Total:</span>
                                    <span className="ml-2 font-medium">{batch.totalSchematics}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Succeeded:</span>
                                    <span className="ml-2 font-medium text-green-600">{batch.succeeded}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Cached:</span>
                                    <span className="ml-2 font-medium text-blue-600">{batch.cached}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Failed:</span>
                                    <span className="ml-2 font-medium text-red-600">{batch.failed}</span>
                                  </div>
                                </div>
                                {batch.duration && (
                                  <div className="text-sm text-muted-foreground">
                                    Duration: {formatDuration(batch.duration)} • Started: {new Date(batch.startTime).toLocaleString()}
                                  </div>
                                )}
                                {batch.resultFileSize && (
                                  <div className="text-sm text-muted-foreground">
                                    Result: {formatBytes(batch.resultFileSize)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Batch Details */}
              {selectedBatch && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>Batch Details</CardTitle>
                        <CardDescription>Batch ID: {selectedBatch.id}</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setSelectedBatch(null)}>
                        Close
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Batch Info */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Status</div>
                        <Badge variant={selectedBatch.status === 'completed' ? 'default' : selectedBatch.status === 'error' ? 'destructive' : 'secondary'}>
                          {selectedBatch.status}
                        </Badge>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Total Schematics</div>
                        <div className="text-lg font-semibold">{selectedBatch.totalSchematics}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Success Rate</div>
                        <div className="text-lg font-semibold">
                          {selectedBatch.totalSchematics > 0
                            ? Math.round((selectedBatch.succeeded / selectedBatch.totalSchematics) * 100)
                            : 0}%
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Cache Hit Rate</div>
                        <div className="text-lg font-semibold text-blue-600">
                          {selectedBatch.succeeded > 0
                            ? Math.round((selectedBatch.cached / selectedBatch.succeeded) * 100)
                            : 0}%
                        </div>
                      </div>
                    </div>

                    {/* Render Options */}
                    {selectedBatch.options && (
                      <div className="border-t pt-4">
                        <div className="text-sm font-medium mb-2">Render Options</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">View:</span>
                            <span className="ml-2">{selectedBatch.options.isometric ? 'Isometric' : 'Perspective'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Background:</span>
                            <span className="ml-2">{selectedBatch.options.background}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Framing:</span>
                            <span className="ml-2 capitalize">{selectedBatch.options.framing}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Resolution:</span>
                            <span className="ml-2">{selectedBatch.options.width}×{selectedBatch.options.height}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Batch Items with Previews */}
                    {batchItems.length > 0 && (
                      <div className="border-t pt-4">
                        <div className="text-sm font-medium mb-4">Schematic Items ({batchItems.length})</div>
                        <div className="max-h-96 overflow-y-auto">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {batchItems.map((item) => (
                              <Card
                                key={item.id}
                                className={`hover:shadow-md transition-shadow ${item.status === 'failed' ? 'border-destructive' : ''
                                  }`}
                              >
                                <CardContent className="p-3">
                                  {/* Thumbnail Preview */}
                                  <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-2 flex items-center justify-center">
                                    {(item.status === 'rendered' || item.status === 'cached') && item.fileHash ? (
                                      <ThumbnailImage fileHash={item.fileHash} filename={item.filename} />
                                    ) : item.status === 'failed' ? (
                                      <div className="flex items-center justify-center h-full bg-destructive/10">
                                        <XCircle className="h-8 w-8 text-destructive" />
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center h-full">
                                        <Clock className="h-8 w-8 text-muted-foreground animate-pulse" />
                                      </div>
                                    )}
                                  </div>

                                  {/* Item Info */}
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      {item.status === 'cached' && <Badge variant="outline" className="text-blue-600 text-xs">Cached</Badge>}
                                      {item.status === 'rendered' && <Badge variant="outline" className="text-green-600 text-xs">Rendered</Badge>}
                                      {item.status === 'failed' && <Badge variant="destructive" className="text-xs">Failed</Badge>}
                                      {item.status === 'pending' && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                                    </div>
                                    <p className="text-xs font-mono truncate" title={item.filename}>
                                      {item.filename}
                                    </p>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                      {item.duration !== undefined && item.duration > 0 && (
                                        <span>{formatDuration(item.duration)}</span>
                                      )}
                                      {item.errorMessage && (
                                        <span className="text-red-600 truncate max-w-[120px]" title={item.errorMessage}>
                                          {item.errorMessage.substring(0, 20)}...
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Download Buttons */}
                    <div className="border-t pt-4 space-y-2">
                      {selectedBatch.downloadUrl && (
                        <Button
                          onClick={() => {
                            const url = selectedBatch.downloadUrl!.startsWith('http')
                              ? selectedBatch.downloadUrl
                              : `${window.location.origin}${selectedBatch.downloadUrl}`;
                            window.open(url, '_blank');
                          }}
                          className="w-full"
                          size="lg"
                        >
                          <Download className="h-5 w-5 mr-2" />
                          Download Rendered Images ({selectedBatch.resultFileSize ? formatBytes(selectedBatch.resultFileSize) : 'N/A'})
                        </Button>
                      )}
                      {selectedBatch.sourceDownloadUrl && (
                        <Button
                          onClick={() => {
                            const url = selectedBatch.sourceDownloadUrl!.startsWith('http')
                              ? selectedBatch.sourceDownloadUrl
                              : `${window.location.origin}${selectedBatch.sourceDownloadUrl}`;
                            window.open(url, '_blank');
                          }}
                          className="w-full"
                          size="lg"
                          variant="outline"
                        >
                          <Download className="h-5 w-5 mr-2" />
                          Download Source Zip
                        </Button>
                      )}
                      {!selectedBatch.downloadUrl && !selectedBatch.sourceDownloadUrl && selectedBatch.status === 'completed' && (
                        <div className="text-center p-4 border rounded bg-muted/50">
                          <p className="text-sm text-muted-foreground">
                            ⚠️ Downloads not available - files may have been cleaned up
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="space-y-6 mt-6">
              {analytics && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
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

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <PieChart className="h-5 w-5" />
                          Status Distribution
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {analytics.distribution.byStatus.length > 0 ? (
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
                                      entry.status === 'error' ? '#ff6b6b' :
                                        entry.status === 'running' ? '#8884d8' :
                                          '#94a3b8'
                                  } />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                              />
                              <Legend />
                            </RechartsPie>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                            No data available
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {insights && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Source Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {insights.bySource.map((source) => (
                              <div key={source.source} className="flex items-center justify-between">
                                <span className="text-sm capitalize">{source.source}</span>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-medium">{source.count}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDuration(source.avg_duration)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>File Size Distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={insights.bySize}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                              <XAxis dataKey="size_range" className="text-xs" />
                              <YAxis className="text-xs" />
                              <Tooltip
                                contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                              />
                              <Bar dataKey="count" fill="#8884d8" />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    </div>
                  )}

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
            </TabsContent>

            {/* Renders Tab */}
            <TabsContent value="renders" className="space-y-6 mt-6">
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
            </TabsContent>

            {/* System Tab */}
            <TabsContent value="system" className="space-y-6 mt-6">
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

              {puppeteerMetrics && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" />
                      Puppeteer Monitoring
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant={puppeteerMetrics.initialized ? 'secondary' : 'destructive'}>
                          {puppeteerMetrics.initialized ? 'Ready' : 'Initializing'}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Active Browsers</p>
                        <p className="text-2xl font-bold">{puppeteerMetrics.activeBrowsers}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Total Pages</p>
                        <p className="text-2xl font-bold">{puppeteerMetrics.totalPages}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">System Uptime</p>
                        <p className="text-sm font-medium">{formatUptime(puppeteerMetrics.systemResources.uptime)}</p>
                      </div>
                    </div>

                    {puppeteerMetrics.browserPerformance.length > 0 && (
                      <div className="mt-6">
                        <h4 className="text-sm font-medium mb-3">Browser Instances</h4>
                        <div className="space-y-3">
                          {puppeteerMetrics.browserPerformance.map((browser) => (
                            <div key={browser.id} className="border rounded-lg p-3 bg-muted/30">
                              <div className="flex items-center justify-between mb-2">
                                <code className="text-xs bg-muted px-2 py-1 rounded">
                                  {browser.id.substring(0, 20)}...
                                </code>
                                <div className="text-xs text-muted-foreground">
                                  {formatUptime(browser.uptime / 1000)}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Pages:</span>
                                  <span className="ml-1 font-medium">{browser.pageCount}</span>
                                </div>
                                {browser.performance && (
                                  <>
                                    <div>
                                      <span className="text-muted-foreground">JS Heap:</span>
                                      <span className="ml-1 font-medium">
                                        {formatBytes(browser.performance.jsHeapSizeUsed)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Tasks:</span>
                                      <span className="ml-1 font-medium">
                                        {(browser.performance.tasks || 0).toFixed(2)}ms
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Layout:</span>
                                      <span className="ml-1 font-medium">
                                        {(browser.performance.layouts || 0).toFixed(2)}ms
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;
