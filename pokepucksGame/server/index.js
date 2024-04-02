/****************************** Script Header ******************************\
Project: PokePucks
Author: Brandon Camacho
Editors: Brandon Camacho, Logan Cruz

<Description>
Code for the backend server-side for the PokePucks game.
\***************************************************************************/
/*
// A list for all the required node modules to install or just use npm i by itself to install all of them since they are all listed in the package.json file
// Make sure terminal is in the server folder
npm i socket.io
npm i express
npm i jsonwebtoken
npm i express-session
npm i ejs
npm i os
npm i -D nodemon (Not required but makes editing this file much more convenient. Nodemon will restart the server automatically every time you save the server.)
// Start the server by using 'npm start' while in the server folder
// Start the server for testing by using 'npm run dev' while in the server folder
// Remember to change the ip address for your formbar instance in the AUTH_URL variable
*/
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import session from 'express-session';
import os from 'os';

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            };
        };
    };
    return 'localhost';
};

const IP_ADDRESS = getLocalIP();

// Define the urls
const AUTH_URL = `http://172.16.3.116:420/oauth`; // `http://ipAddressOfFormbarInstance:port/oauth`;
const THIS_URL = `http://${IP_ADDRESS}:3000/login`; // `http://ipAddressOfThisServer:port/login`;
const GAME_URL = `http://${IP_ADDRESS}:3000/`; // `http://ipAddressOfThisServer:port/`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ADMIN = "YrXoETWEMg5_jKLdAAADtkKSWJqh33L2lrcXAAABWbFLr2OR7EHk719MAAABxkXxW0_R2EuZ7XVXAAAD"; // Make sure this is longer than the maxlength of a username

var allActiveRooms = [];
var allActivePublicRooms = [];
var readyPlayers = new Map();

const app = express(); // Our express server is referred to as app

app.set('view engine', 'ejs');

app.use(
    express.json(), // Allows us to parse JSON data
    express.static(path.join(__dirname, "views")), // Defines our static folder so when we get a request to the root domain, it will send eveything to the public directory that will contain the static assets
    session({
        secret: 'super secret string', // replace with environemnt variable later
        resave: false,
        saveUninitialized: false
    }));

app.get('/get-ip', (req, res) => {
    res.json({ ip: IP_ADDRESS });
});

app.get('/', (req, res) => {
    // Check if user is already logged in
    if (req.session && req.session.user) {
        // User is logged in, redirect to chatroom lobby
        res.redirect('/lobby');
    } else {
        // User is not logged in, render the login page
        res.render('login');
    };
});

app.get('/lobby', (req, res) => {
    // Check if user is logged in
    if (req.session && req.session.user) {
        // User is logged in, render the chatroom lobby with the username
        res.render('lobby', { sessionUser: req.session.user, activeRooms: allActivePublicRooms });
    } else {
        // User is not logged in, redirect to login
        res.redirect('/');
    };
});

app.get('/chatroom', (req, res) => {
    // Check if user is logged in
    if (req.session && req.session.user) {
        res.render('chatroom');
    } else {
        // User is not logged in, redirect to login
        res.redirect('/');
    };
});

app.get('/login', (req, res) => {
    // Check if user is already logged in
    if (req.session && req.session.user) {
        // User is logged in, redirect to chatroom
        res.redirect('/lobby');
    } else {
        if (req.query.token) {
            let tokenData = jwt.decode(req.query.token);
            req.session.token = tokenData;
            req.session.user = tokenData.username;
            res.redirect('/lobby');
        } else {
            res.redirect(`${AUTH_URL}?redirectURL=${THIS_URL}`);
        };
    };
});

app.get('/logout', (req, res) => {
    // Destroy the session and redirect to login
    req.session.destroy((err) => {
        if (err) {
            return console.log(err);
        }
        res.redirect('/');
    });
});

const expressServer = app.listen(PORT, () => {
    console.log(`listening on port ${PORT}`);
});

// State
const UsersState = {
    users: [],
    setUsers: function (newUsersArray) {
        this.users = newUsersArray;
    }
};

// Grabs the server imported from socket.io, gives it the expressServer, and gives it options
const io = new Server(expressServer, {
    cors: {
        // origin allows you to change what is accepted and what is blocked
        origin: process.env.NODE_ENV === "production" ? false : ["http://localhost:3000", GAME_URL] // Looks at the node environment. If the node environemnt equals production, origin is set to false because we don't want anyone outside of the domain the server is currently on to access it. If it doesn't equal production, origin is set to the address that we will allow to access our socket.io server
    }
});

// Create a map to hold game instances for each room
const games = new Map();

// Once a connection is established, listen for a socket
io.on('connection', socket => {
    console.log(`User ${socket.id} connected`);

    // Upon connection - only to user
    socket.emit('message', buildMsg(ADMIN, "Welcome to Chat App!"));

    socket.on('enterRoom', ({ name, room, privacy, method }, callback) => {
        console.log(`${name} is entering room: ${room}`);
        // leave previous room
        const prevRoom = getUser(socket.id)?.room;

        if (prevRoom) {
            socket.leave(prevRoom);
            io.to(prevRoom).emit('message', buildMsg(ADMIN, `${name} has left the room`));
        };

        const user = activateUser(socket.id, name, room);

        // cannot update previous room users list until after the state update in activate user
        if (prevRoom) {
            io.to(prevRoom).emit('userList', {
                users: getUsersInRoom(prevRoom)
            });
        };

        // If user is creating a room, user creates and joins the room like normal
        if (method === 'create') {
            console.log('create room start test');
            // join room
            socket.join(user.room);

            // to user who joined
            socket.emit('message', buildMsg(ADMIN, `You have joined the ${user.room} chat room`));

            // to everyone else
            socket.broadcast.to(user.room).emit('messsage', buildMsg(ADMIN, `${user.name} has joined the room`));

            // update user list for room
            io.to(user.room).emit('userList', {
                users: getUsersInRoom(user.room)
            });

            allActiveRooms.push(room);
            allActivePublicRooms.push(room);

            // If a room is private, it removes it from the array
            if (privacy === 'private') {
                allActivePublicRooms.splice(allActivePublicRooms.indexOf(room), 1);
            };

            // update rooms list for everyone
            io.emit('roomList', {
                rooms: allActivePublicRooms,
            });

            console.log(`# of Users in room after create: ${getUsersInRoom(user.room).length}`);

            console.log('create room end test');
        };

        if (method === 'join') {
            console.log('join room start test');
            let roomExists = false;

            // Iterate over all active rooms
            for (let i = 0; i < allActiveRooms.length; i++) {
                if (allActiveRooms[i] === room) {
                    console.log("Room:", room);
                    console.log('Room Exists');
                    roomExists = true;
                    break;
                };
            };

            if (roomExists) {
                console.log('Room Exists');
                if (getUsersInRoom(user.room).length <= 2) {
                    // Join the room
                    socket.join(user.room);

                    console.log(`# of Users in room after Join: ${getUsersInRoom(user.room).length}`);

                    // Send messages
                    socket.emit('message', buildMsg(ADMIN, `You have joined the ${user.room} chat room`));
                    io.to(user.room).emit('message', buildMsg(ADMIN, `${user.name} has joined the room`));

                    // Update user list for room
                    io.to(user.room).emit('userList', {
                        users: getUsersInRoom(user.room)
                    });

                    // If a room is private, remove it from the public rooms array
                    if (privacy === 'private') {
                        allActivePublicRooms.splice(allActivePublicRooms.indexOf(room), 1);
                    };

                    // Update rooms list for everyone
                    io.emit('roomList', {
                        rooms: allActivePublicRooms,
                    });

                    if (callback) callback(); // No error
                } else { // Room is full
                    socket.emit('joinedRoomFull');
                    return;
                };
            } else { // Room does not exist
                console.log('Room does not exist');
                socket.emit('joinedRoomNotFound');
                return;
            };
            console.log('join room end test');
        };

        // Server-side game logic
        let gameStarted = new Map();

        // Goes through the steps of the games
        socket.on('step-game', function (room, callback) {
            console.log('step-game test');
            const game = games.get(room);
            if (game) {
                try {
                    game.step();
                    let gameData = {
                        game: game,
                    };
                    callback(null, { status: 'success' });
                    io.to(room).emit('step-game-success', { status: 'success' }, gameData);
                } catch (error) {
                    callback(error.message);
                };
            } else {
                callback('No game found for this room');
            };
        });

        socket.on('gameStart', () => {
            // Logic for starting the game
            if (gameStarted.get(room)) {
                callback('Game already started');
            } else {
                gameStarted.set(room, true);
                io.to(room).emit('game started');
                console.log('gameStart test');

                function objectsAreEqual(a, b) {
                    return JSON.stringify(a) === JSON.stringify(b);
                };
                /**************************************************************
                 * This is the code for the game side of PokePucks. 
                 * The classes create the player, Pucks, slammers, and the game between code lines 328 and 369.
                 * The Game has three stages. Setup, Loop, and End.
                 * Setup is where the players are decided, special rules are decided, health stacks are built, the arena is built, and the slammers are picked,between code lines 371 and 442.
                 * Loop is where the game is played. 
                 * Loop has 6 phases. Top off, Knockout, Count Attacks, Make Attacks, Discard Pucks, and Check for Winner.
                 * Top off is where the arena is filled with pucks from the player's health stacks, in code lines 444 to 490
                 * Knockout is where the player's slammers are placed in the center if they have no pucks in their health stacks, in code lines 492 to 507.
                 * Count Attacks is where the players get the minimum of 1 attack in code lines 509 to 518.
                 * Make Attacks is where the players make their attacks and flip pucks in the arena, in code lines 520 to 617.
                 * Discard Pucks is where the players can use pucks and remove them from the arena and place them in the discard pile, in code lines 619 to 631.
                 * Check for Winner is where the game checks if a player has won, in code lines 633 to 654.
                 * End is where the game ends and the winner is displayed.in code lines 656 to 673.
                 * 
                 * 
                 * Future Plans:
                 * -Have a unique way of allowing the players to throw their slammers at the stack of pucks.
                 * -Have special abilities for slammers.
                 * -Have special abilities for pucks.
                 * -Show the custom pogs in canvas.
                 * -Have more than two players play the game
                 * -Optimize the code
                 * -Make the game more visually appealing
                 * -Add more features to the game
                 */
                var tempArena = [];
                var turn;
                class Player {
                    constructor(hp, power, prize, attack, slammer) {
                        this.hp = hp;
                        this.power = power;
                        this.prize = prize;
                        this.attack = attack;
                        this.slammer = slammer;
                    };
                };
                class Puck {
                    constructor(name, weight, side) {
                        this.name = name;
                        this.weight = weight;
                        this.side = side;
                    };
                    flip() {
                        // flip
                        let power;
                        power = Math.floor(Math.random() * 100) + 1 + this.weight;
                        if (power > 100) {
                            power = 100;
                        };
                        return power;
                    };
                };
                class Slammer {
                    constructor(name, weight, side) {
                        this.name = name;
                        this.weight = weight;
                        this.side = side;
                    };

                    attack() {
                        // attack
                        let att;
                        att = Math.floor(Math.random() * 100)
                        if (att > 100) {
                            att = 100;
                        };
                        return att;
                    };
                };
                class Game {
                    constructor() {
                        this.players = [new Player([], [], [], 0, 'squirtle'), new Player([], [], [], 0, 'bulbasaur')];
                        this.stage = 'setup';
                        this.phase = 0;
                        this.stepcount = 0;
                        this.arena = [];
                        this.turn = 0;
                    };

                    step() {
                        switch (this.stage) {
                            case 'setup':
                                this.stage_setup();
                                break;
                            case 'loop':
                                this.stage_loop();
                                break;
                            case 'end':
                                this.stage_end();
                                break;
                            default:
                                break;
                        };
                    };

                    stage_setup() {
                        switch (this.phase) {
                            case 0: // Decide players
                                /****************************************
                                 * This is where the players are decided.
                                 * The turns are decided randomly.
                                 * The players are given a backup of their pogs, just in case their health stack goes undefinded.
                                 * The phase is increased by 1.
                                 */
                                this.phase++;
                                this.turn = Math.floor(Math.random() * 2);
                                console.log(this.players[0]);
                                console.log(this.players[1]);
                                this.players[0].pogsBackup = [];
                                this.players[1].pogsBackup = [];
                                break;
                            case 1: // Decide Special Rules
                                /*`***************************************
                                    * This is where the special rules are decided.
                                    * To be added later.
                                    * The phase is increased by 1.
                                */
                                this.phase++;
                                break;
                            case 2: // Build health stack
                                /****************************************
                                 * This is where the health stacks are built.
                                 * The health stacks are built with 14 pogs.
                                 * The phase is increased by 1.
                                */
                                // for each player, add 14 pogs to their health stack
                                if (this.players[0].hp.length == 0 && this.players[1].hp.length == 0) {
                                    for (let i = 0; i < this.players.length; i++) {
                                        for (let j = 0; j < 15; j++) {
                                            console.log(this.players[i].hp);
                                            this.players[i].hp.push(new Puck('pog', 1, 'down'));
                                        };
                                    };
                                };
                                console.log(this.players[0].hp.length);
                                console.log(this.players[1].hp.length);
                                this.phase++;
                                break;
                            case 3: // Build arena
                                // while arena is < 8, each player pops 1 from hp to arena
                                /***************************************
                                 * This is where the arena is built.
                                 * The arena is built with 8 pogs, by the players health stack, reducing theirs to 11 pogs.
                                 * The phase is increased by 1.
                                */
                                while (this.arena.length < 8) {
                                    this.arena.push(this.players[0].hp.pop());
                                    this.arena.push(this.players[1].hp.pop());
                                };
                                this.phase++;
                                break;
                            case 4: // Pick a slammer
                                // each player picks a slammer
                                /**************************************
                                 * This is where the slammers are picked.
                                 * The slammers are picked by the players.
                                 * The phase is increased by 1.
                                 * The game is set to the loop stage.
                                */
                                this.players[0].Slammer = new Slammer('slammer', 1, 'down');
                                this.players[1].Slammer = new Slammer('slammer', 1, 'down');
                                this.phase++;
                                break;
                        };
                        if (this.phase > 4) {
                            this.stage = 'loop';
                            this.phase = 0;
                        };
                    };

                    stage_loop() {
                        switch (this.phase) {
                            case 0: // Top off
                                /**************************************
                                 * This is where the arena is topped off.
                                 * The arena is topped off with pogs from the players health stacks.
                                 * If a player has no pogs in their health stack, they are placed in critical.
                                 * The phase is increased by 1.
                                */
                                console.log('Arena:', this.arena);
                                console.log('case 0 test');
                                if (this.arena === undefined && this.players[0].hp.length > 0 && this.players[1].hp.length > 0) {
                                    this.arena = [];
                                    for (let i = 0; i < Math.floor(Math.random() * 8) + 1; i++) {
                                        this.arena.push(new Puck('pog', 1, 'down'));
                                    }
                                }
                                console.log(this.players[0].Slammer.side);
                                console.log(this.players[1].Slammer.side);
                                if (this.turn == 0 && this.players[0].hp.length === 0 && this.players[0].pogsBackup.length > 0) {
                                    this.players[0].hp = [...this.players[0].pogsBackup];
                                    this.players[0].pogsBackup = [];
                                };
                                if (this.turn == 1 && this.players[1].hp.length === 0 && this.players[1].pogsBackup.length > 0) {
                                    this.players[1].hp = [...this.players[1].pogsBackup];
                                    this.players[1].pogsBackup = [];
                                };
                                // while arena is < 8, player pops 1 from hp to arena
                                // if player has no pogs in their stack, stop and put into critical
                                while (this.arena.length < 8) {
                                    console.log('Arena Length:' + this.arena.length);
                                    console.log('Arena:' + this.arena);
                                    if (this.players[0].hp.length == 0) {
                                        break;
                                    } else if (this.turn == 0) {
                                        if (this.players[0].hp.length > 0) {
                                            this.arena.push(this.players[0].hp.pop());
                                            console.log('player 1 losing hp test');
                                        };
                                    };
                                    if (this.players[1].hp.length == 0) {
                                        break;
                                    } else if (this.turn == 1) {
                                        if (this.players[1].hp.length > 0) {
                                            this.arena.push(this.players[1].hp.pop());
                                            console.log('player 2 losing hp test');
                                        };
                                    };
                                    console.log('Arena Length End:' + this.arena.length);
                                    console.log('Player 1 HP:' + this.players[0].hp.length);
                                    console.log('Player 2 HP:' + this.players[1].hp.length);
                                };
                                this.phase++;
                                break;
                            case 1:// Knockout
                                /*************************************
                                 * This is where the players are knocked out.
                                 * If a player has no pogs in their stack, move that player's slammer into the center.
                                 * The phase is increased by 1.
                                */
                                if (this.arena === undefined && this.players[0].hp.length > 0 && this.players[1].hp.length > 0) {
                                    this.arena = [];
                                    for (let i = 0; i < Math.floor(Math.random() * 8) + 1; i++) {
                                        this.arena.push(new Puck('pog', 1, 'down'));
                                    }
                                }
                                console.log('case 1 test');
                                console.log(this.players[0].Slammer.side);
                                console.log(this.players[1].Slammer.side);
                                // if player has no pogs in their stack, move that player's slammer into the center.
                                console.log('Before replacing slammer with turn:', this.arena, this.turn);
                                // Before replacing the player's pogs with the slammer, store the pogs
                                if (this.players[0].hp.length <= 0 && this.turn === 1) {
                                    this.players[0].pogsBackup = [...this.players[0].hp];
                                    this.players[0].hp = [];
                                    tempArena = this.arena;
                                    this.arena = [];
                                    this.arena.push(this.players[0].Slammer);
                                };
                                if (this.players[1].hp.length <= 0 && this.turn === 0) {
                                    this.players[1].pogsBackup = [...this.players[1].hp];
                                    this.players[1].hp = [];
                                    tempArena = this.arena;
                                    this.arena = [];
                                    this.arena.push(this.players[1].Slammer);
                                };

                                this.phase++;
                                break;
                            case 2:// Count Attacks
                                /************************************
                                 * This is where the players get the minimum of 1 attack.
                                 * The phase is increased by 1.
                                */
                                console.log('After replacing slammer with turn:', this.arena, this.turn);
                                console.log(this.players[0].Slammer.side);
                                console.log(this.players[1].Slammer.side);
                                //Each player gets the bare minimum of 1 attack, before checking for abilities, status, and other special rules.
                                this.players[0].attacks = 1;
                                this.players[1].attacks = 1;
                                console.log(this.players[0].hp.length);
                                console.log(this.players[1].hp.length);
                                this.phase++;
                                break;
                            case 3://Make Attacks
                                /***********************************
                                 * This is where the players make their attacks.
                                 * The players make their attacks and flip pucks in the arena.
                                 * If a player has no pogs in their stack, the slammer is placed for the attack to see if it flips or not.
                                 * The phase is increased by 1.
                                */
                                console.log('case 3 test');
                                console.log('Arena:', this.arena.hp);
                                console.log(this.players[0].Slammer.side);
                                console.log(this.players[1].Slammer.side);
                                //The current player makes an attack, then the other player makes an attack. Repeat until all attacks have been made. 
                                //If a player has flipped over pogs in the arena, pick them up and place it in prize, the rest that have been knocked
                                // over are placed back into the arena.
                                let power;
                                if (this.turn == 0) {
                                    while (this.players[0].attacks > 0) {
                                        console.log('Player attack Slammer');
                                        console.log(this.players[0].attacks);
                                        power = this.players[this.turn].Slammer.attack();
                                        let slammerInArena = false;
                                        for (let i = 0; i < this.arena.length; i++) {
                                            console.log('Arena Slammer:', this.arena[i]);
                                            console.log('Player Slammer:', this.players[this.turn].Slammer);
                                            if (objectsAreEqual(this.arena[i], this.players[this.turn].Slammer)) {
                                                console.log('Slammer in Arena');
                                                slammerInArena = true;
                                                break;
                                            };
                                        };

                                        console.log('slammerInArena:', slammerInArena);
                                        console.log('this.turn:', this.turn);
                                        if (slammerInArena && this.players[1].hp.length == 0) {
                                            console.log('Player 2 slammer attack test');
                                            let power1 = this.players[1].Slammer.attack();
                                            if (power > power1) {
                                                this.players[1].Slammer.side = 'up';
                                            };
                                        };
                                        console.log('Arena for Player 1:', this.arena);

                                        console.log('Slammer weight:', this.weight);
                                        for (let i = 0; i < this.arena.length; i++) {
                                            if (this.arena[i] && typeof this.arena[i].flip === 'function') {
                                                console.log('Puck weight:', this.arena[i].weight);
                                                let flipnum = this.arena[i].flip();
                                                console.log('power:', power);
                                                console.log('flipnum:', flipnum);
                                                if (power > flipnum) {
                                                    console.log('Puck is flipped');
                                                    this.arena[i].side = 'up';
                                                    console.log(this.arena[i])
                                                    this.players[this.turn].prize.push(this.arena[i]);
                                                    this.arena.splice(i, 1);
                                                    console.log(this.arena[i])
                                                } else {
                                                    console.log(this.arena[i])
                                                    console.log('Puck is not flipped');

                                                }
                                            }
                                        }

                                        this.players[this.turn].attacks--;
                                    };
                                } else {
                                    while (this.players[1].attacks > 0) {
                                        let slammerInArena = false;
                                        for (let i = 0; i < this.arena.length; i++) {
                                            console.log('Arena Slammer:', this.arena[i]);
                                            console.log('Player Slammer:', this.players[this.turn].Slammer);
                                            if (objectsAreEqual(this.arena[i], this.players[this.turn].Slammer)) {
                                                console.log('Slammer in Arena');
                                                slammerInArena = true;
                                                break;
                                            };
                                        }
                                        power = this.players[this.turn].Slammer.attack();
                                        if (slammerInArena && this.players[0].hp.length == 0) {
                                            let power1 = this.players[0].Slammer.attack();
                                            if (power > power1) {
                                                this.players[0].Slammer.side = 'up';
                                            };
                                        };
                                        console.log('Arena for Player 2:', this.arena);

                                        console.log('Slammer weight:', this.weight);
                                        for (let i = 0; i < this.arena.length; i++) {
                                            if (this.arena[i] && typeof this.arena[i].flip === 'function') {
                                                console.log('Puck weight:', this.arena[i].weight);
                                                let flipnum = this.arena[i].flip();
                                                console.log('power:', power);
                                                console.log('flipnum:', flipnum);
                                                if (power > flipnum) {

                                                    console.log('Puck is flipped');
                                                    this.arena[i].side = 'up';
                                                    console.log(this.arena[i])
                                                    this.players[this.turn].prize.push(this.arena[i]);
                                                    this.arena.splice(i, 1);
                                                    console.log(this.arena[i])
                                                } else {
                                                    console.log(this.arena[i])
                                                    console.log('Puck is not flipped');
                                                    ;
                                                }
                                            }
                                        }

                                        this.players[this.turn].attacks--;
                                    };
                                };
                                if (this.turn == 0) {
                                    // Remove the slammer from the arena
                                    const slammerIndex = this.arena.findIndex(pog => pog === this.players[0].Slammer);
                                    if (slammerIndex !== -1) {
                                        this.arena.splice(slammerIndex, 1);
                                    };
                                    // Add the pogs back into the arena from tempArena

                                } else {
                                    // Remove the slammer from the arena
                                    const slammerIndex = this.arena.findIndex(pog => pog === this.players[1].Slammer);
                                    if (slammerIndex !== -1) {
                                        this.arena.splice(slammerIndex, 1);
                                    };
                                }
                                console.log('Arena:', this.arena.hp);
                                if (this.arena === undefined && this.players[0].hp.length > 0 && this.players[1].hp.length > 0) {
                                    let num = Math.floor(Math.random() * 8); + 1;
                                    for (let i = 0; i < num; i++) {
                                        this.arena.push(new Puck('pog', 1, 'down'));
                                    }
                                }
                                this.phase++;
                                break;
                            case 4://Discard pucks
                                /**********************************
                                 * This is where the players can use pucks.
                                 * If a player wants to use a puck, remove that puck from the power stack and place it in the discard pile, while
                                 * checking rules for that puck, and special rules.
                                 * The phase is increased by 1.
                                */
                                console.log('case 4 test');
                                console.log(this.players[0].Slammer.side);
                                console.log(this.players[1].Slammer.side);
                                if (this.turn == 0) {
                                    this.turn = 1;
                                } else {
                                    this.turn = 0;
                                };
                                this.phase++;
                                break;
                            case 5://Check for winner
                                /*********************************
                                 * This is where the game checks for a winner.
                                 * If a player is the only player remaining with either pogs or non flipped slammer, they win.
                                 * The phase is increased by 1.
                                */
                                console.log('case 5 test');
                                console.log(this.players[0].Slammer.side);
                                console.log(this.players[1].Slammer.side);
                                if (this.arena === undefined && this.players[0].hp.length > 0 && this.players[1].hp.length > 0) {
                                    let num = Math.floor(Math.random() * 8); + 1;
                                    for (let i = 0; i < num; i++) {
                                        this.arena.push(new Puck('pog', 1, 'down'));
                                    }
                                }

                                //If player is the only player remaining with either hp or non flipped slammer, they win.
                                if (this.players[0].hp.length == 0 && this.players[0].Slammer.side == 'up') {
                                    this.stage = 'end';
                                    console.log('player 2 wins');
                                };
                                if (this.players[1].hp.length == 0 && this.players[1].Slammer.side == 'up') {
                                    this.stage = 'end';
                                    console.log('player 1 wins');
                                };



                                console.log('Arena:', this.arena);
                                this.phase++;
                                break;
                        };
                        if (this.phase > 5 && this.stage == 'loop') {
                            this.stage = 'loop';
                            this.phase = 0;
                        };
                        if (this.stage == 'end') {
                            this.phase = 0;
                        };
                    };
                    stage_end() {
                        /********************
                         * This is where the game ends.
                         * The game ends and the winner is displayed.
                         * The game is reset.
                         */
                        if (this.players[1].hp.length == 0 && this.players[1].Slammer.side == 'up') {
                            console.log('P1 wins');
                        };
                        if (this.players[0].hp.length == 0 && this.players[0].Slammer.side == 'up') {
                            console.log('P2 wins');
                        };
                    };
                };

                const game = new Game();

                function startGame(callback) {
                    const game = games.get(room);
                    if (game) {
                        try {
                            game.step();
                            callback(null, { status: 'success' });
                        } catch (error) {
                            callback(error.message);
                        };
                    } else {
                        callback('No game found for this room');
                    };
                    console.log('Game:', game);
                };

                // You need to pass a callback function when you call startGame
                startGame(function (error, result) {
                    if (error) {
                        console.error(error);
                    } else {
                        console.log(result);
                    }
                });

                games.set(user.room, game);
                console.log('Games Map:', games);
                console.log('gameEnd test');
            };
        });
    });

    socket.on('player ready', function (room, callback) {
        if (!readyPlayers.has(room)) {
            readyPlayers.set(room, []);
        };

        readyPlayers.get(room).push(socket.id);

        console.log(readyPlayers.get(room));
        console.log(readyPlayers);
        console.log(`Player ${socket.id} is ready in room ${room}. Total ready players: ${readyPlayers.get(room).length}`);

        let roomSize = getUsersInRoom(room).length;
        if (readyPlayers.get(room).length === roomSize) {
            console.log(`All players are ready in room ${room}. Starting game.`);
            io.to(room).emit('all players ready');
        };
    });

    // When user leaves a room - to all others
    socket.on('leaveRoom', () => {
        console.log('leaveRoom test');
        const user = getUser(socket.id);
        userLeavesApp(socket.id);
        readyPlayers.forEach((value, key) => {
            readyPlayers.set(key, value.filter(id => id !== socket.id));
        });
        if (user) {
            console.log(`# of Users in room after Leave: ${getUsersInRoom(user.room).length}`);
            socket.leave(user.room);
            if (getUsersInRoom(user.room).length === 0) {
                games.delete(user.room);
                console.log('room gone');
                // Loops through the allActiveRooms array
                for (let i = 0; i < allActiveRooms.length; i++) {
                    // If the room value of user is equal to any of the array items
                    if (user.room === allActiveRooms[i]) {
                        // Removes that room from the allActiveRooms array
                        allActiveRooms.splice(allActiveRooms.indexOf(user.room), 1);
                    };
                };
                // Loops through the allActivePublicRooms array
                for (let i = 0; i < allActivePublicRooms.length; i++) {
                    // If the room value of user is equal to any of the array items
                    if (user.room === allActivePublicRooms[i]) {
                        // Removes that room from the allActivePublicRooms array
                        allActivePublicRooms.splice(allActivePublicRooms.indexOf(user.room), 1);
                    };
                };
            };

            socket.emit('leaveRoomConfirmation');

            io.to(user.room).emit('message', buildMsg(ADMIN, `${user.name} has left the room`));

            io.to(user.room).emit('userList', {
                users: getUsersInRoom(user.room)
            });

            io.emit('roomList', {
                rooms: allActivePublicRooms
            });
        };

        console.log(`User ${socket.id} disconnected`);
    });

    // When user disconnects - to all others
    socket.on('disconnect', () => {
        console.log('disconnect test');
        const user = getUser(socket.id);
        userLeavesApp(socket.id);
        readyPlayers.forEach((value, key) => {
            readyPlayers.set(key, value.filter(id => id !== socket.id));
        });
        if (user) {
            console.log(`# of Users in room after Disconnect: ${getUsersInRoom(user.room).length}`);
            if (getUsersInRoom(user.room).length === 0) {
                games.delete(user.room);
                console.log('room gone');
                // Loops through the allActiveRooms array
                for (let i = 0; i < allActiveRooms.length; i++) {
                    // If the room value of user is equal to any of the array items
                    if (user.room === allActiveRooms[i]) {
                        // Removes that room from the allActiveRooms array
                        allActiveRooms.splice(allActiveRooms.indexOf(user.room), 1);
                    };
                };
                // Loops through the allActivePublicRooms array
                for (let i = 0; i < allActivePublicRooms.length; i++) {
                    // If the room value of user is equal to any of the array items
                    if (user.room === allActivePublicRooms[i]) {
                        // Removes that room from the allActivePublicRooms array
                        allActivePublicRooms.splice(allActivePublicRooms.indexOf(user.room), 1);
                    };
                };
            };
            io.to(user.room).emit('message', buildMsg(ADMIN, `${user.name} has left the room`));

            io.to(user.room).emit('userList', {
                users: getUsersInRoom(user.room)
            });

            io.emit('roomList', {
                rooms: allActivePublicRooms
            });
        };

        console.log(`User ${socket.id} disconnected`);
    });

    // Listening for a message event
    socket.on('message', ({ name, text }) => {
        const room = getUser(socket.id)?.room;
        if (room) {
            io.to(room).emit('message', buildMsg(name, text, socket.id));
        };
    });

    // Listen for activity
    socket.on('activity', (name) => {
        const room = getUser(socket.id)?.room;
        if (room) {
            socket.broadcast.to(room).emit('activity', name);
        };
    });
});

function buildMsg(name, text, id) {
    return {
        name,
        text,
        id,
        time: new Intl.DateTimeFormat('default', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        }).format(new Date())
    };
};

// User functions
function activateUser(id, name, room) {
    const user = { id, name, room };
    UsersState.setUsers([
        ...UsersState.users.filter(user => user.id !== id),
        user
    ]);
    return user;
};

function userLeavesApp(id) {
    UsersState.setUsers(
        UsersState.users.filter(user => user.id !== id)
    );
};

function getUser(id) {
    return UsersState.users.find(user => user.id === id);
};

function getUsersInRoom(room) {
    return UsersState.users.filter(user => user.room === room);
};