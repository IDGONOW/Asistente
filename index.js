const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://asistente.up.railway.app/oauth2callback';

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
let accessToken = null;

app.use(session({
  secret: 'asistentevirtual',
  resave: false,
  saveUninitialized: true,
}));

// RUTA 1: Autenticación
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar'
    ],
  });
  res.redirect(authUrl);
});

// RUTA 2: Callback de OAuth
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    accessToken = tokens.access_token;
    res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
  } catch (error) {
    res.send('❌ Error en la autenticación: ' + error.message);
  }
});

// RUTA 3: Webhook para mensajes de Telegram
app.post('/webhook', async (req, res) => {
  console.log('📩 Webhook recibido:', JSON.stringify(req.body));
  const message = req.body.message;

  if (!message || !message.text) return res.sendStatus(200);

  const text = message.text.toLowerCase();
  const chatId = message.chat.id;

  console.log('📨 Mensaje recibido:', text);

  try {
    if (text.startsWith('agregar tarea:')) {
      const tarea = message.text.split(':')[1].trim();
      const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });

      const nueva = await tasks.tasks.insert({
        tasklist: '@default',
        requestBody: {
          title: tarea
        }
      });

      await sendMessage(chatId, `✅ Tarea creada: ${tarea}`);
    }

    else if (text.startsWith('crear reunion:')) {
      const resumen = message.text.split(':')[1].trim();
      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      const now = new Date();
      const fin = new Date(now.getTime() + 30 * 60000); // 30 min

      const evento = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: resumen,
          start: { dateTime: now.toISOString() },
          end: { dateTime: fin.toISOString() }
        }
      });

      await sendMessage(chatId, `📅 Reunión creada: ${resumen}`);
    }

    else {
      await sendMessage(chatId, '🤖 Comando no reconocido. Usa:\n- Agregar tarea: [texto]\n- Crear reunion: [texto]');
    }

  } catch (err) {
    console.error('❌ Error:', err);
    await sendMessage(chatId, '⚠️ Error al procesar tu solicitud.');
  }

  res.sendStatus(200);
});

// Función para responder en Telegram
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    const res = await axios.post(url, {
      chat_id: chatId,
      text: text
    });
    console.log('✅ Mensaje enviado a Telegram:', res.data);
  } catch (error) {
    console.error('❌ Error al enviar mensaje a Telegram:', error.response?.data || error.message);
  }
}

// Iniciar servidor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en puerto ${PORT}`);
});

