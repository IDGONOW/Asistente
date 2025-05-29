const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const session = require('express-session');

const app = express();
app.use(bodyParser.json());
app.use(session({ secret: 'asistente-secreto', resave: false, saveUninitialized: true }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

let accessToken = null;

function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  return axios.post(url, { chat_id: chatId, text })
    .then(res => {
      console.log('✅ Mensaje enviado a Telegram:', res.data);
    })
    .catch(err => {
      console.error('❌ Error al enviar mensaje a Telegram:\n', err.response?.data || err.message);
    });
}

app.get('/auth', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/tasks', 'https://www.googleapis.com/auth/calendar']
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    accessToken = tokens;
    res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
  } catch (error) {
    console.error('❌ Error autenticando:', error.message);
    res.status(500).send('Error al autenticar');
  }
});

app.post('/webhook', async (req, res) => {
  console.log('📩 Webhook recibido:', JSON.stringify(req.body));

  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text.trim();
    const messageId = message.message_id;

    console.log('📨 Mensaje recibido:', text);

    if (!accessToken) {
      await sendMessage(chatId, '🔐 Primero necesitas autorizarme aquí:\n' + REDIRECT_URI.replace('/oauth2callback', '/auth'));
      return res.sendStatus(200);
    }

    oAuth2Client.setCredentials(accessToken);

    if (text.toLowerCase().startsWith('agregar tarea')) {
      const tarea = text.replace(/^agregar tarea[:\-]?\s*/i, '');
      await agregarTareaGoogle(tarea);
      await sendMessage(chatId, `✅ Tarea añadida:\n${tarea}`);
    } else if (text.toLowerCase().startsWith('crear reunión')) {
      const titulo = text.replace(/^crear reunión[:\-]?\s*/i, '');
      await crearEventoCalendar(titulo);
      await sendMessage(chatId, `📅 Reunión creada:\n${titulo}`);
    } else {
      await sendMessage(chatId, `👋 Hola, soy tu asistente personal.\n\nComandos:\n- Agregar tarea: ...\n- Crear reunión: ...`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error en webhook:', error.message);
    res.sendStatus(500);
  }
});

async function agregarTareaGoogle(nombreTarea) {
  const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });
  await tasks.tasks.insert({
    tasklist: '@default',
    requestBody: {
      title: nombreTarea
    }
  });
  console.log('🗂️ Tarea creada:', nombreTarea);
}

async function crearEventoCalendar(titulo) {
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  const inicio = new Date();
  inicio.setMinutes(inicio.getMinutes() + 10);
  const fin = new Date(inicio.getTime() + 30 * 60000);

  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: titulo,
      start: { dateTime: inicio.toISOString() },
      end: { dateTime: fin.toISOString() }
    }
  });
  console.log('📅 Evento creado en Calendar:', titulo);
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en puerto ${PORT}`);
});

