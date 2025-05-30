const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const chrono = require('chrono-node');
const { google } = require('googleapis');
const session = require('express-session');

const app = express();
app.use(bodyParser.json());
app.use(session({ secret: 'asistente-secret', resave: false, saveUninitialized: true }));

// Captura de variables con fallback
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET;
const REDIRECT_URI =
  process.env.REDIRECT_URI || `https://${process.env.RAILWAY_STATIC_URL}/auth/callback`;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ CLIENT_ID o CLIENT_SECRET faltan. Revisa tus variables de entorno.');
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// ----------- RUTAS -----------

app.get('/auth', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar'
    ],
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    req.session.tokens = tokens;
    res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
  } catch (error) {
    console.error('❌ Error en el callback:', error.message);
    res.send('❌ Error al autenticar con Google.');
  }
});

app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text.trim().toLowerCase();

  try {
    if (!oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
      await sendMessage(chatId, `🔐 Antes de continuar, debes autorizar en: https://${process.env.RAILWAY_STATIC_URL}/auth`);
      return res.sendStatus(200);
    }

    oAuth2Client.setCredentials(oAuth2Client.credentials);

    if (text.startsWith('agregar tarea:')) {
      const tarea = msg.text.split(':')[1].trim();
      const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });

      await tasks.tasks.insert({ tasklist: '@default', requestBody: { title: tarea } });
      await sendMessage(chatId, `✅ Tarea creada: ${tarea}`);
    }

    else if (text.startsWith('crear reunion:')) {
      const resumen = msg.text.split(':')[1].trim();
      const fecha = chrono.parseDate(resumen);
      const inicio = fecha || new Date();
      const fin = new Date(inicio.getTime() + 30 * 60000);

      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: resumen,
          start: { dateTime: inicio.toISOString() },
          end: { dateTime: fin.toISOString() },
        }
      });

      await sendMessage(chatId, `📅 Reunión creada: ${resumen}`);
    }

    else {
      await sendMessage(chatId, '🤖 Usa:\n- Agregar tarea: [texto]\n- Crear reunion: [texto con fecha]');
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error en webhook:', error.message);
    await sendMessage(chatId, '⚠️ Ocurrió un error procesando tu solicitud.');
    res.sendStatus(500);
  }
});

async function sendMessage(chatId, text) {
  try {
    const res = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
    console.log('✅ Enviado:', res.data);
  } catch (error) {
    console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});


