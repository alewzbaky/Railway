const app = require("../index"); // هذا يستدعي السيرفر من الجذر
module.exports = (req, res) => app(req, res); // هذا يرسل الطلب إلى السيرفر
