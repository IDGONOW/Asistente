// index.js (versión corregida con zona horaria y respuesta a Telegram)

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const session = require('express-session');
const { google } = require('googleapis');
const chrono = require('chrono-node');

const app = express();
app.use(bodyParser.json());
app.use(session({ secret: 'asistente-secret', resave: false, saveUninitialized: true }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let credentials = null;

app.get('/auth', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks'
    ]
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  credentials = tokens;
  res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const message = req.body.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.toLowerCase();

  try {
    oAuth2Client.setCredentials(credentials);

    if (text.startsWith('agregar tarea:')) {
      const taskText = message.text.split(':')[1].trim();
      const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });
      await tasks.tasks.insert({ tasklist: '@default', requestBody: { title: taskText } });
      await sendMessage(chatId, `📝 Tarea agregada: ${taskText}`);
    } else if (text.startsWith('crear reunion:')) {
      const eventText = message.text.split(':')[1].trim();
      const parsedDate = chrono.parseDate(eventText, { timezone: 'America/Lima' });
      if (!parsedDate) {
        await sendMessage(chatId, `❌ No se pudo entender la fecha u hora de la reunión.`);
        return;
      }

      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      const endDate = new Date(parsedDate.getTime() + 60 * 60 * 1000);

      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: eventText,
          start: { dateTime: parsedDate.toISOString(), timeZone: 'America/Lima' },
          end: { dateTime: endDate.toISOString(), timeZone: 'America/Lima' }
        }
      });

      await sendMessage(chatId, `📅 Reunión creada: ${eventText}`);
    } else {
      await sendMessage(chatId, `🤖 Comando no reconocido.`);
    }
  } catch (err) {
    console.error('❌ Error procesando webhook:', err);
    await sendMessage(chatId, '❌ Error al procesar tu solicitud.');
  }
});

async function sendMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text
    });
  } catch (err) {
    console.error('❌ Error al enviar mensaje a Telegram:', err.response?.data || err.message);
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Escuchando en puerto ${PORT}`));



