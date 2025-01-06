import React, { useState, useEffect } from 'react';
const { ipcRenderer } = window.require('electron');

interface BrowserConfig {
  id: string;
  name: string;
}

interface BrowserStatus {
  isRunning: boolean;
  lastChecked: number;
  inProgress: boolean;
  action?: 'starting' | 'stopping';
}

function StatusDisplay({ status }: { status: BrowserStatus | null }) {
  if (!status) return null;
  
  const timeSinceLastCheck = Date.now() - status.lastChecked;
  const isStale = timeSinceLastCheck > 10000; // 如果超过10秒没有更新，认为状态可能已过期
  
  const getStatusText = () => {
    if (isStale) return '状态未知';
    if (status.inProgress) {
      return status.action === 'starting' ? '启动中...' : '停止中...';
    }
    return status.isRunning ? '运行中' : '已停止';
  };

  const getStatusColor = () => {
    if (isStale) return '#757575';
    if (status.inProgress) return '#fb8c00';
    return status.isRunning ? '#2e7d32' : '#c62828';
  };
  
  return (
    <div style={{ 
      marginTop: '10px',
      fontSize: '14px'
    }}>
      <strong>状态：</strong>
      <span style={{ 
        color: getStatusColor(),
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px'
      }}>
        {getStatusText()}
        {isStale && (
          <span style={{ 
            fontSize: '12px',
            color: '#757575' 
          }}>
            ({Math.floor(timeSinceLastCheck / 1000)}秒前更新)
          </span>
        )}
      </span>
    </div>
  );
}

function App() {
  const [configs, setConfigs] = useState<BrowserConfig[]>([]);
  const [instanceStatuses, setInstanceStatuses] = useState<Map<string, BrowserStatus>>(new Map());
  const [newName, setNewName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    loadConfigs();
    updateStatus(); // 立即更新一次状态
    const statusInterval = setInterval(updateStatus, 1000);
    
    // 监听状态更新事件
    ipcRenderer.on('browser-status-update', (_, id: string, status: BrowserStatus) => {
      setInstanceStatuses(prev => {
        const newMap = new Map(prev);
        if (status) {
          newMap.set(id, {
            isRunning: Boolean(status.isRunning),
            lastChecked: Number(status.lastChecked) || Date.now(),
            inProgress: Boolean(status.inProgress),
            action: status.action
          });
        } else {
          newMap.delete(id);
        }
        return newMap;
      });
    });
    
    return () => {
      clearInterval(statusInterval);
      ipcRenderer.removeAllListeners('browser-status-update');
    };
  }, []);

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 3000);
  };

  const loadConfigs = async () => {
    try {
      setLoading(true);
      const result = await ipcRenderer.invoke('get-browser-configs');
      if (result.success === false) {
        showError(result.error || '加载配置失败');
        return;
      }
      setConfigs(result);
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载配置失败');
      console.error('Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async () => {
    try {
      const statuses = await ipcRenderer.invoke('get-all-browser-statuses');
      // 确保状态对象有效
      if (statuses && typeof statuses === 'object') {
        const statusMap = new Map<string, BrowserStatus>();
        Object.entries(statuses).forEach(([id, status]) => {
          if (status && typeof status === 'object') {
            const typedStatus = status as {
              isRunning?: boolean;
              lastChecked?: number;
              inProgress?: boolean;
              action?: 'starting' | 'stopping';
            };
            
            // 确保所有必需的字段都存在并且类型正确
            statusMap.set(id, {
              isRunning: Boolean(typedStatus.isRunning),
              lastChecked: Number(typedStatus.lastChecked) || Date.now(),
              inProgress: Boolean(typedStatus.inProgress),
              action: typedStatus.action
            });
          }
        });
        setInstanceStatuses(statusMap);
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      showError('请输入浏览器实例名称');
      return;
    }

    if (name.length > 50) {
      showError('实例名称不能超过50个字符');
      return;
    }

    if (configs.some(config => config.name === name)) {
      showError('实例名称已存在');
      return;
    }

    try {
      setActionInProgress('saving');
      const config: BrowserConfig = {
        id: Date.now().toString(),
        name: name
      };
      
      const result = await ipcRenderer.invoke('save-browser-config', config);
      if (!result.success) {
        showError(result.error || '保存配置失败');
        return;
      }

      await loadConfigs();
      setNewName('');
    } catch (error) {
      showError(error instanceof Error ? error.message : '保存配置失败');
      console.error('Failed to save config:', error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleLaunch = async (config: BrowserConfig) => {
    try {
      setActionInProgress(`launching-${config.id}`);
      const result = await ipcRenderer.invoke('launch-browser', config);
      if (!result.success) {
        showError(result.error || '启动浏览器失败');
      }
      // 立即更新状态
      await updateStatus();
    } catch (error) {
      showError(error instanceof Error ? error.message : '启动浏览器失败');
      console.error('Failed to launch browser:', error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStop = async (id: string) => {
    try {
      setActionInProgress(`stopping-${id}`);
      const result = await ipcRenderer.invoke('stop-browser', id);
      if (!result.success) {
        showError(result.error || '停止浏览器失败');
      }
      // 立即更新状态
      await updateStatus();
    } catch (error) {
      showError(error instanceof Error ? error.message : '停止浏览器失败');
      console.error('Failed to stop browser:', error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setActionInProgress(`deleting-${id}`);
      const result = await ipcRenderer.invoke('delete-browser-config', id);
      if (!result.success) {
        showError(result.error || '删除配置失败');
      } else {
        await loadConfigs();
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : '删除配置失败');
      console.error('Failed to delete config:', error);
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        加载中...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>浏览器实例管理器</h1>
      
      {error && (
        <div style={{
          padding: '10px',
          marginBottom: '20px',
          backgroundColor: '#ffebee',
          color: '#c62828',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}
      
      <div style={{ marginBottom: '20px' }}>
        <h2>添加新实例</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="输入实例名称"
            required
            disabled={actionInProgress === 'saving'}
            style={{
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              width: '200px'
            }}
          />
          <button 
            type="submit" 
            disabled={actionInProgress === 'saving'}
            style={{
              backgroundColor: '#1976d2',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: actionInProgress === 'saving' ? 'not-allowed' : 'pointer',
              opacity: actionInProgress === 'saving' ? 0.7 : 1
            }}
          >
            {actionInProgress === 'saving' ? '添加中...' : '添加实例'}
          </button>
        </form>
      </div>

      <h2>浏览器实例列表</h2>
      <div style={{ display: 'grid', gap: '10px' }}>
        {configs.map(config => (
          <div
            key={config.id}
            style={{
              padding: '15px',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              backgroundColor: 'white',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '10px'
            }}>
              <div>
                <h3 style={{ margin: 0 }}>{config.name}</h3>
                <StatusDisplay status={instanceStatuses.get(config.id) || null} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {instanceStatuses.get(config.id)?.isRunning ? (
                  <button
                    onClick={() => handleStop(config.id)}
                    disabled={actionInProgress === `stopping-${config.id}` || instanceStatuses.get(config.id)?.inProgress}
                    style={{
                      backgroundColor: '#c62828',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: (actionInProgress === `stopping-${config.id}` || instanceStatuses.get(config.id)?.inProgress) ? 'not-allowed' : 'pointer',
                      opacity: (actionInProgress === `stopping-${config.id}` || instanceStatuses.get(config.id)?.inProgress) ? 0.7 : 1
                    }}
                  >
                    {instanceStatuses.get(config.id)?.inProgress ? '停止中...' : '停止'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleLaunch(config)}
                    disabled={actionInProgress === `launching-${config.id}` || instanceStatuses.get(config.id)?.inProgress}
                    style={{
                      backgroundColor: '#2e7d32',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: (actionInProgress === `launching-${config.id}` || instanceStatuses.get(config.id)?.inProgress) ? 'not-allowed' : 'pointer',
                      opacity: (actionInProgress === `launching-${config.id}` || instanceStatuses.get(config.id)?.inProgress) ? 0.7 : 1
                    }}
                  >
                    {instanceStatuses.get(config.id)?.inProgress ? '启动中...' : '启动'}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(config.id)}
                  disabled={actionInProgress === `deleting-${config.id}` || instanceStatuses.get(config.id)?.isRunning || instanceStatuses.get(config.id)?.inProgress}
                  style={{
                    backgroundColor: (instanceStatuses.get(config.id)?.isRunning || instanceStatuses.get(config.id)?.inProgress) ? '#ccc' : '#f44336',
                    color: 'white',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    cursor: (actionInProgress === `deleting-${config.id}` || instanceStatuses.get(config.id)?.isRunning || instanceStatuses.get(config.id)?.inProgress) ? 'not-allowed' : 'pointer',
                    opacity: (actionInProgress === `deleting-${config.id}` || instanceStatuses.get(config.id)?.isRunning || instanceStatuses.get(config.id)?.inProgress) ? 0.7 : 1
                  }}
                >
                  {actionInProgress === `deleting-${config.id}` ? '删除中...' : '删除'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App; 