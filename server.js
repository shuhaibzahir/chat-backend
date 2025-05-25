import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// In-memory data
const users = new Map(); // socketId -> user
const privateMessages = new Map(); // conversationId -> messages[]
const groups = new Map(); // groupId -> { name, members[], messages[] }

const getConversationId = (id1, id2) => [id1, id2].sort().join('-');

io.on('connection', (socket) => { 

  // Register user
  socket.on('register', ({ username }) => {
    const existingUser = Array.from(users.values()).find(user =>
      user.username.toLowerCase() === username.toLowerCase()
    );

    if (existingUser) {
      users.delete(existingUser.id);
      existingUser.id = socket.id;
      users.set(socket.id, existingUser);
    } else {
      const user = {
        id: socket.id,
        username,
        joinedAt: new Date()
      };
      users.set(socket.id, user);
    }

    io.emit('user-list', Array.from(users.values()));
    socket.emit('group-list', Array.from(groups.values()));
    console.log(`User registered: ${username} (${socket.id})`);
  });

  // Private message
  socket.on('private-message', ({ to, content }) => {
    const from = socket.id;
    const fromUser = users.get(from);
    const toUser = users.get(to);
    if (!fromUser || !toUser || from === to) return;

    const conversationId = getConversationId(from, to);
    const message = {
      id: uuidv4(), from, to, content, timestamp: new Date()
    };

    if (!privateMessages.has(conversationId)) privateMessages.set(conversationId, []);
    privateMessages.get(conversationId).push(message);

    io.to(from).to(to).emit('private-message', message);

  });

  // Private history
  socket.on('get-private-history', ({ with: withId }) => {
    const conversationId = getConversationId(socket.id, withId);
    const messages = privateMessages.get(conversationId) || [];
    socket.emit('private-history', { withId, messages });
  });

  // Create group
  socket.on('create-group', ({ name, members }) => {
    const creator = socket.id;
    const groupId = uuidv4();
    const group = {
      id: groupId,
      name,
      createdBy: creator,
      createdAt: new Date(),
      members: [creator, ...members],
      messages: []
    };
    groups.set(groupId, group);
    io.emit('group-list', Array.from(groups.values()));
  });
  
  socket.on('group-message', ({ groupId, content }) => {
    const from = socket.id;
    const group = groups.get(groupId);
    if (!group || !group.members.includes(from)) return;
  
    const message = {
      id: uuidv4(),
      groupId,
      from,
      content,
      timestamp: new Date()
    };
    group.messages.push(message);
  
    // Emit once to all members
    io.to(group.members).emit('group-message', message);
  });

  // Group history
  socket.on('get-group-history', ({ groupId }) => {
    const group = groups.get(groupId);
    if (group && group.members.includes(socket.id)) {
      socket.emit('group-history', {
        groupId,
        messages: group.messages
      });
    }
  });

  // Typing
  socket.on('typing', ({ to, isTyping }) => {
    if (to !== socket.id) io.to(to).emit('user-typing', { from: socket.id, isTyping });
  });

  // Group typing
  socket.on('group-typing', ({ groupId, isTyping }) => {
    const from = socket.id;
    const group = groups.get(groupId);
    if (!group || !group.members.includes(from)) return;
    group.members.filter(id => id !== from).forEach(id =>
      io.to(id).emit('user-group-typing', { groupId, from, isTyping })
    );
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      for (const [groupId, group] of groups.entries()) {
        group.members = group.members.filter(id => id !== socket.id);
        if (group.members.length === 0) groups.delete(groupId);
      }
      io.emit('user-list', Array.from(users.values()));
      io.emit('group-list', Array.from(groups.values()));
    }
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
