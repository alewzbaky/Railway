const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BINANCE_API_BASE = 'https://api.binance.com';

// إعداد محدود الطلبات
const rateLimiter = new RateLimiterMemory({
  points: 60,    // عدد الطلبات المسموح بها
  duration: 60,  // خلال هذه الفترة بالثواني
});

// الوسائط المتوسطة
app.use(cors());
app.use(express.json());

// تعطيل بعض إعدادات Helmet للسماح بالطلبات من خارج النطاق
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false
  })
);

// وسيط التحقق من معدل الطلبات
app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (error) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
});

// دالة مساعدة لإنشاء توقيع لمصادقة الطلب
function createBinanceSignature(apiSecret, queryStringParams) {
  const queryString = Object.entries(queryStringParams)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

// مسار الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'Binance API Relay' });
});

// مسار فحص ping
app.get('/ping', async (req, res) => {
  try {
    await axios.get(`${BINANCE_API_BASE}/api/v3/ping`);
    res.json({ status: 'success', binance_status: 'online' });
  } catch (error) {
    console.error('Ping error:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// مسار الحصول على سعر عملة محددة
app.get('/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/ticker/price`, {
      params: { symbol }
    });
    
    // إعادة التنسيق لتوحيد الواجهة
    res.json({ price: response.data.price });
  } catch (error) {
    console.error(`Error fetching price for ${req.params.symbol}:`, error.message);
    
    if (error.response) {
      res.status(error.response.status).json({ 
        error: 'Failed to fetch price from Binance',
        details: error.response.data
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// مسار الحصول على جميع الأسعار
app.get('/prices', async (req, res) => {
  try {
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/ticker/price`);
    
    // تحويل البيانات إلى قاموس
    const prices = {};
    response.data.forEach(item => {
      prices[item.symbol] = item.price;
    });
    
    res.json(prices);
  } catch (error) {
    console.error('Error fetching prices:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// مسار الحصول على معلومات السوق
app.get('/exchangeInfo', async (req, res) => {
  try {
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/exchangeInfo`);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching exchange info:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// مسار الحصول على بيانات الشموع
app.get('/klines', async (req, res) => {
  try {
    const { symbol, interval, limit } = req.query;
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/klines`, {
      params: { symbol, interval, limit }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching klines:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// مسار الحصول على معلومات التداول لآخر 24 ساعة
app.get('/ticker/24hr', async (req, res) => {
  try {
    let response;
    if (req.query.symbol) {
      response = await axios.get(`${BINANCE_API_BASE}/api/v3/ticker/24hr`, {
        params: { symbol: req.query.symbol }
      });
    } else {
      response = await axios.get(`${BINANCE_API_BASE}/api/v3/ticker/24hr`);
    }
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching 24hr ticker:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// مسار للحصول على معلومات الأرصدة (يتطلب مفاتيح API)
app.get('/balances', async (req, res) => {
  try {
    // التحقق من وجود مفاتيح API في رؤوس الطلب
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];
    
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ 
        error: 'Missing API credentials', 
        message: 'X-API-KEY and X-API-SECRET headers are required for account endpoints' 
      });
    }
    
    // إنشاء توقيع لمصادقة الطلب
    const timestamp = Date.now();
    const queryParams = { timestamp };
    const signature = createBinanceSignature(apiSecret, queryParams);
    
    // إجراء الطلب مع التوقيع
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/account`, {
      params: {
        ...queryParams,
        signature
      },
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    });
    
    if (response.data && response.data.balances) {
      // تصفية الأرصدة الصفرية في التنسيق المطلوب
      const filteredBalances = response.data.balances
        .filter(balance => parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0)
        .map(balance => ({
          asset: balance.asset,
          available: balance.free,
          onOrder: balance.locked
        }));
      
      res.json(filteredBalances);
    } else {
      res.status(500).json({ error: 'Invalid response from Binance API' });
    }
  } catch (error) {
    console.error('Error fetching account balances:', error.message);
    
    // إرجاع رسالة خطأ مفصلة
    if (error.response) {
      res.status(error.response.status).json({
        error: 'Failed to fetch balances from Binance',
        code: error.response.status,
        message: error.response.data.msg || error.message
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// مسار للحصول على معلومات الحساب الكاملة
app.get('/account', async (req, res) => {
  try {
    // التحقق من وجود مفاتيح API في رؤوس الطلب
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];
    
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ 
        error: 'Missing API credentials', 
        message: 'X-API-KEY and X-API-SECRET headers are required for account endpoints' 
      });
    }
    
    // إنشاء توقيع لمصادقة الطلب
    const timestamp = Date.now();
    const queryParams = { timestamp };
    const signature = createBinanceSignature(apiSecret, queryParams);
    
    // إجراء الطلب مع التوقيع
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/account`, {
      params: {
        ...queryParams,
        signature
      },
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching account info:', error.message);
    
    // إرجاع رسالة خطأ مفصلة
    if (error.response) {
      res.status(error.response.status).json({
        error: 'Failed to fetch account info from Binance',
        code: error.response.status,
        message: error.response.data.msg || error.message
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// مسار للحصول على المعاملات المفتوحة
app.get('/openOrders', async (req, res) => {
  try {
    // التحقق من وجود مفاتيح API في رؤوس الطلب
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];
    
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ 
        error: 'Missing API credentials', 
        message: 'X-API-KEY and X-API-SECRET headers are required for account endpoints' 
      });
    }
    
    // إنشاء توقيع لمصادقة الطلب
    const timestamp = Date.now();
    const queryParams = { timestamp };
    
    // إضافة رمز العملة إذا كان متوفرًا
    if (req.query.symbol) {
      queryParams.symbol = req.query.symbol;
    }
    
    const signature = createBinanceSignature(apiSecret, queryParams);
    
    // إجراء الطلب مع التوقيع
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/openOrders`, {
      params: {
        ...queryParams,
        signature
      },
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching open orders:', error.message);
    
    // إرجاع رسالة خطأ مفصلة
    if (error.response) {
      res.status(error.response.status).json({
        error: 'Failed to fetch open orders from Binance',
        code: error.response.status,
        message: error.response.data.msg || error.message
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// مسار للحصول على سجل المعاملات
app.get('/myTrades', async (req, res) => {
  try {
    // التحقق من وجود مفاتيح API في رؤوس الطلب
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];
    
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ 
        error: 'Missing API credentials', 
        message: 'X-API-KEY and X-API-SECRET headers are required for account endpoints' 
      });
    }
    
    // التحقق من وجود رمز العملة (مطلوب لهذه النقطة النهائية)
    if (!req.query.symbol) {
      return res.status(400).json({ 
        error: 'Missing symbol parameter', 
        message: 'Symbol parameter is required for myTrades endpoint' 
      });
    }
    
    // إنشاء توقيع لمصادقة الطلب
    const timestamp = Date.now();
    const queryParams = { 
      timestamp,
      symbol: req.query.symbol
    };
    
    // إضافة معلمات اختيارية إذا كانت متوفرة
    if (req.query.limit) queryParams.limit = req.query.limit;
    if (req.query.fromId) queryParams.fromId = req.query.fromId;
    if (req.query.startTime) queryParams.startTime = req.query.startTime;
    if (req.query.endTime) queryParams.endTime = req.query.endTime;
    
    const signature = createBinanceSignature(apiSecret, queryParams);
    
    // إجراء الطلب مع التوقيع
    const response = await axios.get(`${BINANCE_API_BASE}/api/v3/myTrades`, {
      params: {
        ...queryParams,
        signature
      },
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching trade history:', error.message);
    
    // إرجاع رسالة خطأ مفصلة
    if (error.response) {
      res.status(error.response.status).json({
        error: 'Failed to fetch trade history from Binance',
        code: error.response.status,
        message: error.response.data.msg || error.message
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// تصدير التطبيق لـ Vercel
module.exports = app;

// تشغيل الخادم المحلي فقط إذا تم تشغيل الملف مباشرة
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Binance Relay server running on port ${PORT}`);
  });
}
