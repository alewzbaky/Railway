const app = require("../index"); // يستدعي السيرفر من الجذر
module.exports = (req, res) => app(req, res); // يرسل الطلب إلى السيرفر