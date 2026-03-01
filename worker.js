// Cloudflare Worker for D1 Database API
// 这个Worker提供了与前端应用交互的API接口
// 新增功能：Memos 分享链接生成与公开访问（参考 index(2).js 实现）

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // 处理OPTIONS请求（预检请求）
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 处理分享页面重定向 /share/<publicId> -> /share.html?id=<publicId>
    const shareMatch = path.match(/^\/share\/([a-zA-Z0-9-]+)$/);
    if (shareMatch) {
      const publicId = shareMatch[1];
      const targetUrl = new URL('/share.html', url.origin);
      targetUrl.searchParams.set('id', publicId);
      return Response.redirect(targetUrl.toString(), 302);
    }
    
    // 只处理API请求，其他请求交给静态文件处理
    if (path.startsWith('/api/')) {
      try {
        // ---------- 新增：公开获取分享的 Memo ----------
        const publicMemoMatch = path.match(/^\/api\/public\/memo\/([a-zA-Z0-9-]+)$/);
        if (publicMemoMatch && request.method === 'GET') {
          const publicId = publicMemoMatch[1];
          return handlePublicMemo(publicId, env, corsHeaders);
        }
        
        // ---------- 新增：生成或取消分享链接 ----------
        const shareMemoMatch = path.match(/^\/api\/memos\/([^\/]+)\/share$/);
        if (shareMemoMatch) {
          const memoId = shareMemoMatch[1]; // 前端 memo_id
          if (request.method === 'POST') {
            return handleShareMemo(request, memoId, env, corsHeaders);
          } else if (request.method === 'DELETE') {
            return handleUnshareMemo(request, memoId, env, corsHeaders);
          }
        }
        
        // ---------- 原有路由 ----------
        if (path === '/api/health') {
          return handleHealthCheck(env, corsHeaders);
        } else if (path === '/api/init') {
          return handleInitDatabase(env, corsHeaders);
        } else if (path.startsWith('/api/memos')) {
          return handleMemos(request, env, corsHeaders);
        } else if (path.startsWith('/api/settings')) {
          return handleSettings(request, env, corsHeaders);
        } else {
          // 未知的API路径
          return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        console.error('Worker error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 对于非API请求，返回null让Cloudflare Pages处理静态文件
    return null;
  }
};

// ==================== 原有函数（保持不变）====================
async function handleHealthCheck(env, headers) {
  try {
    await env.DB.prepare('SELECT 1').first();
    return new Response(JSON.stringify({ 
      status: 'ok', 
      message: 'D1数据库连接正常',
      timestamp: new Date().toISOString()
    }), {
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: 'D1数据库连接失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

async function handleInitDatabase(env, headers) {
  try {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS memos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memo_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(memo_id, user_id)
      )
    `);

    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        pinned_memos TEXT DEFAULT '[]',
        theme_color TEXT DEFAULT '#818CF8',
        dark_mode INTEGER DEFAULT 0,
        hitokoto_config TEXT DEFAULT '{"enabled":true,"types":["a","b","c","d","i","j","k"]}',
        font_config TEXT DEFAULT '{"selectedFont":"default"}',
        background_config TEXT DEFAULT '{"imageUrl":"","brightness":50,"blur":10}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_user_id ON memos(user_id)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos(created_at)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)');

    return new Response(JSON.stringify({ 
      success: true, 
      message: '数据库初始化成功' 
    }), {
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '数据库初始化失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

async function handleMemos(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;
  const userId = url.searchParams.get('userId');
  
  if (!userId) {
    return new Response(JSON.stringify({ error: '缺少userId参数' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (method === 'GET') {
      const { results } = await env.DB
        .prepare('SELECT * FROM memos WHERE user_id = ? ORDER BY created_at DESC')
        .bind(userId)
        .all();
      
      return new Response(JSON.stringify({ success: true, data: results }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else if (method === 'POST') {
      const body = await request.json();
      const { memo_id, content, tags, created_at, updated_at } = body;
      
      if (!memo_id || !content) {
        return new Response(JSON.stringify({ error: '缺少必要参数' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const existingMemo = await env.DB
        .prepare('SELECT * FROM memos WHERE memo_id = ? AND user_id = ?')
        .bind(memo_id, userId)
        .first();
      
      if (existingMemo) {
        await env.DB
          .prepare('UPDATE memos SET content = ?, tags = ?, updated_at = ? WHERE memo_id = ? AND user_id = ?')
          .bind(content, JSON.stringify(tags || []), updated_at || new Date().toISOString(), memo_id, userId)
          .run();
      } else {
        await env.DB
          .prepare('INSERT INTO memos (memo_id, user_id, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(memo_id, userId, content, JSON.stringify(tags || []), created_at || new Date().toISOString(), updated_at || new Date().toISOString())
          .run();
      }
      
      return new Response(JSON.stringify({ success: true, message: 'Memo保存成功' }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else if (method === 'DELETE') {
      const memoId = url.searchParams.get('memoId');
      
      if (!memoId) {
        return new Response(JSON.stringify({ error: '缺少memoId参数' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      await env.DB
        .prepare('DELETE FROM memos WHERE user_id = ? AND memo_id = ?')
        .bind(userId, memoId)
        .run();
      
      return new Response(JSON.stringify({ success: true, message: 'Memo删除成功' }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: '不支持的请求方法' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '处理memos请求失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

async function handleSettings(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;
  const userId = url.searchParams.get('userId');
  
  if (!userId) {
    return new Response(JSON.stringify({ error: '缺少userId参数' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (method === 'GET') {
      const settings = await env.DB
        .prepare('SELECT * FROM user_settings WHERE user_id = ?')
        .bind(userId)
        .first();
      
      return new Response(JSON.stringify({ success: true, data: settings }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else if (method === 'POST') {
      const body = await request.json();
      const { pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config } = body;
      
      const existingSettings = await env.DB
        .prepare('SELECT * FROM user_settings WHERE user_id = ?')
        .bind(userId)
        .first();
      
      if (existingSettings) {
        await env.DB
          .prepare('UPDATE user_settings SET pinned_memos = ?, theme_color = ?, dark_mode = ?, hitokoto_config = ?, font_config = ?, background_config = ?, updated_at = ? WHERE user_id = ?')
          .bind(
            JSON.stringify(pinned_memos || []),
            theme_color || '#818CF8',
            dark_mode ? 1 : 0,
            JSON.stringify(hitokoto_config || { enabled: true, types: ["a", "b", "c", "d", "i", "j", "k"] }),
            JSON.stringify(font_config || { selectedFont: "default" }),
            JSON.stringify(background_config || { imageUrl: "", brightness: 50, blur: 10 }),
            new Date().toISOString(),
            userId
          )
          .run();
      } else {
        await env.DB
          .prepare('INSERT INTO user_settings (user_id, pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(
            userId,
            JSON.stringify(pinned_memos || []),
            theme_color || '#818CF8',
            dark_mode ? 1 : 0,
            JSON.stringify(hitokoto_config || { enabled: true, types: ["a", "b", "c", "d", "i", "j", "k"] }),
            JSON.stringify(font_config || { selectedFont: "default" }),
            JSON.stringify(background_config || { imageUrl: "", brightness: 50, blur: 10 }),
            new Date().toISOString(),
            new Date().toISOString()
          )
          .run();
      }
      
      return new Response(JSON.stringify({ success: true, message: '用户设置保存成功' }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: '不支持的请求方法' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '处理用户设置请求失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

// ==================== 新增：辅助函数 ====================
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

// ==================== 新增：生成分享链接 ====================
async function handleShareMemo(request, memoId, env, headers) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) {
    return jsonResponse({ error: '缺少userId参数' }, 400, headers);
  }

  // 检查 KV 绑定
  if (!env.MEMOS_KV) {
    return jsonResponse({ error: 'KV存储未配置，请绑定 MEMOS_KV' }, 500, headers);
  }

  try {
    // 查询 memo 是否存在，获取自增 id
    const memo = await env.DB
      .prepare('SELECT id FROM memos WHERE memo_id = ? AND user_id = ?')
      .bind(memoId, userId)
      .first();

    if (!memo) {
      return jsonResponse({ error: 'Memo not found' }, 404, headers);
    }

    const memoInternalId = memo.id;
    let publicId = await env.MEMOS_KV.get(`memo_share:${memoInternalId}`);

    if (!publicId) {
      publicId = crypto.randomUUID();
      // 存储映射，默认7天过期（可根据需求调整）
      const expirationTtl = 86400 * 7; // 7天
      await env.MEMOS_KV.put(`public_memo:${publicId}`, JSON.stringify({ memoInternalId }), { expirationTtl });
      await env.MEMOS_KV.put(`memo_share:${memoInternalId}`, publicId, { expirationTtl });
    }

    const { protocol, host } = new URL(request.url);
    const shareUrl = `${protocol}//${host}/share/${publicId}`;
    return jsonResponse({ success: true, shareUrl, publicId }, 200, headers);
  } catch (error) {
    return jsonResponse({ success: false, message: '生成分享链接失败', error: error.message }, 500, headers);
  }
}

// ==================== 新增：取消分享 ====================
async function handleUnshareMemo(request, memoId, env, headers) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) {
    return jsonResponse({ error: '缺少userId参数' }, 400, headers);
  }

  if (!env.MEMOS_KV) {
    return jsonResponse({ error: 'KV存储未配置，请绑定 MEMOS_KV' }, 500, headers);
  }

  try {
    const memo = await env.DB
      .prepare('SELECT id FROM memos WHERE memo_id = ? AND user_id = ?')
      .bind(memoId, userId)
      .first();

    if (!memo) {
      return jsonResponse({ error: 'Memo not found' }, 404, headers);
    }

    const memoInternalId = memo.id;
    const publicId = await env.MEMOS_KV.get(`memo_share:${memoInternalId}`);
    if (publicId) {
      await Promise.all([
        env.MEMOS_KV.delete(`public_memo:${publicId}`),
        env.MEMOS_KV.delete(`memo_share:${memoInternalId}`)
      ]);
    }
    return jsonResponse({ success: true, message: '分享已取消' }, 200, headers);
  } catch (error) {
    return jsonResponse({ success: false, message: '取消分享失败', error: error.message }, 500, headers);
  }
}

// ==================== 新增：公开获取 Memo 内容 ====================
async function handlePublicMemo(publicId, env, headers) {
  if (!env.MEMOS_KV) {
    return jsonResponse({ error: 'KV存储未配置，请绑定 MEMOS_KV' }, 500, headers);
  }

  try {
    const data = await env.MEMOS_KV.get(`public_memo:${publicId}`, 'json');
    if (!data || !data.memoInternalId) {
      return jsonResponse({ error: '分享链接不存在或已过期' }, 404, headers);
    }

    const memo = await env.DB
      .prepare('SELECT memo_id, content, tags, created_at, updated_at FROM memos WHERE id = ?')
      .bind(data.memoInternalId)
      .first();

    if (!memo) {
      return jsonResponse({ error: 'Memo内容不存在' }, 404, headers);
    }

    // 解析 tags 为数组
    if (typeof memo.tags === 'string') {
      try { memo.tags = JSON.parse(memo.tags); } catch { memo.tags = []; }
    }

    return jsonResponse({ success: true, data: memo }, 200, headers);
  } catch (error) {
    return jsonResponse({ success: false, message: '获取分享内容失败', error: error.message }, 500, headers);
  }
}
