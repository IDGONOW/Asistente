// index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const chrono = require('chrono-node');
const { google } = require('googleapis');
const moment = require('moment-timezone');

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const tasks = google.tasks({ version: 'v1', auth: oauth2Client });

app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks'
    ]
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
});

function parseDate(text) {
  const result = chrono.parse(text, new Date(), { forwardDate: true });
  if (result.length > 0) {
    return moment(result[0].start.date()).tz('America/Lima').format();
  }
  return null;
}

async function createTask(title) {
  await tasks.tasks.insert({
    tasklist: '@default',
    requestBody: { title }
  });
}

async function createEvent(summary, startTime) {
  const endTime = moment(startTime).add(1, 'hour').format();
  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      start: { dateTime: startTime },
      end: { dateTime: endTime }
    }
  });
}

async function sendMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text
    });
  } catch (err) {
    console.error('❌ Error al enviar mensaje a Telegram:\n', err.response.data);
  }
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text.toLowerCase();

  if (text.startsWith('agregar tarea:')) {
    const taskText = text.replace('agregar tarea:', '').trim();
    await createTask(taskText);
    await sendMessage(chatId, `📝 Tarea creada: ${taskText}`);
  } else if (text.startsWith('crear reunion:')) {
    const eventText = text.replace('crear reunion:', '').trim();
    const date = parseDate(eventText);
    if (date) {
      await createEvent(eventText, date);
      await sendMessage(chatId, `📅 Reunión creada: ${eventText} a las ${moment(date).tz('America/Lima').format('HH:mm')}`);
    } else {
      await sendMessage(chatId, '❌ No pude entender la fecha.');
    }
  } else {
    await sendMessage(chatId, '🤖 Comando no reconocido. Usa "Agregar tarea:" o "Crear reunion:"');
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en puerto ${PORT}`);
});




