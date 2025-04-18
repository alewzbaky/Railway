const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/api/market-data/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching from Binance:", err.message);
    res.status(500).json({ error: "Failed to fetch data from Binance" });
  }
});

// ✅ هذا السطر يجعل الكود يشتغل على Vercel بشكل صحيح
module.exports = (req, res) => app(req, res);
