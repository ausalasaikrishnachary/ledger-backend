const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendMail = async ({ to, subject, html }) => {
  if (!to) return; // safely skip if mail missing

  await transporter.sendMail({
    from: `"Order System" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};

module.exports = { sendMail };
