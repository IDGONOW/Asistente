const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const chrono = require('chrono-node');
const { google } = require('googleapis');
const session = require('express-session');
const path = require('path');

const app = express();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `https://${process.env.RAILWAY_STATIC_URL}/auth/callback`
);

app.use(bodyParser.json());
app.use(session({ secret: 'asistente-secret', resave: false, saveUninitialized: true }));

// Página de autenticación
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks']
  });
  res.redirect(authUrl);
});

// Callback de autenticación
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  req.session.tokens = tokens;
  res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
});

// Webhook de Telegram
app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  console.log('📨 Mensaje recibido:', text);

  // Asegurar credenciales
  if (!oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
    return await sendMessage(chatId, '❌ Primero necesitas autenticarte en https://' + process.env.RAILWAY_STATIC_URL + '/auth');
  }

  oAuth2Client.setCredentials(oAuth2Client.credentials);

  if (text.toLowerCase().startsWith('agregar tarea:')) {
    const tarea = text.split(':')[1].trim();
    const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });

    try {
      await tasks.tasks.insert({
        tasklist: '@default',
        requestBody: { title: tarea }
      });
      await sendMessage(chatId, `✅ Tarea creada: ${tarea}`);
    } catch (error) {
      console.error('❌ Error al crear tarea:', error);
      await sendMessage(chatId, '❌ No se pudo crear la tarea.');
    }

  } else if (text.toLowerCase().startsWith('crear reunion:')) {
    const resumen = text.split(':')[1].trim();
    const parsedDate = chrono.parseDate(resumen);
    const startTime = parsedDate || new Date();
    const endTime = new Date(startTime.getTime() + 30 * 60000);

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    try {
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: resumen,
          start: { dateTime: startTime.toISOString() },
          end: { dateTime: endTime.toISOString() }
        }
      });
      await sendMessage(chatId, `📅 Reunión creada: ${resumen}`);
    } catch (error) {
      console.error('❌ Error al crear reunión:', error);
      await sendMessage(chatId, '❌ No se pudo crear la reunión.');
    }

  } else {
    await sendMessage(chatId, '🤖 Puedes decirme:\n- Agregar tarea: [tarea]\n- Crear reunion: [reunión con fecha]');
  }

  res.sendStatus(200);
});

// Función para enviar mensajes a Telegram
async function sendMessage(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const res = await axios.post(url, {
      chat_id: chatId,
      text: text
    });
    console.log('✅ Mensaje enviado:', res.data);
  } catch (error) {
    console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en puerto ${PORT}`);
});

