const path = require('path');
const http = require('http');
const express = require('express');
const socketio = require('socket.io');
const { json } = require('express');
const { dir } = require('console');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static(path.join(__dirname, 'client')));
app.use('/images', express.static(__dirname + 'client/Images'));
const port = process.env.PORT || 3000 ;
server.listen(port, () => { console.log(`Server running at port:${port}`); });

const maxMembers = 4;
const minMembers = 3;
var significance = new Map();
significance.set('A', 14);
significance.set('K', 13);
significance.set('Q', 12);
significance.set('J', 11);
significance.set('10', 10);
significance.set('9', 9);
significance.set('8', 8);
significance.set('7', 7);
significance.set('6', 6);
significance.set('5', 5);
significance.set('4', 4);
significance.set('3', 3);
significance.set('2', 2);

class Games extends Map{
	static counter = 0;
	add(game) {
		super.set(++Games.counter, game);        //add in map
		game.membersRoom = "M" + Games.counter;
		game.activeMembersRoom = "AM" + Games.counter;
		return Games.counter;                    //return index
	}
};
class Game{
	members = [];
	starterIndex;
	membersRoom;
	activeMembersRoom;
	hasBegun = false;
	// recurring properties after game starts (are placed here to avoid passing as arguments repeatedly)
	pile = [];
	highest = -1;
	turnHolder;
	ignoreThola = true;
	firstTurn = true;
	turnUId;
	turnSocket;
	validSuits;
	tholaProgram = false;
	constructor() {
		this.turnHolder = this.starterIndex;
	}
	addMember(member) {
		this.members.push(member);
		return this.members.length - 1; // return index where this member is stored
	}
	divideCards() {
		//making new deck
		var deck = [];
		let numbers = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
		let suits = ['♥', '♦', '♣', '♠'];
		numbers.forEach(n => {
			suits.forEach(s => {
				let card = { 'number': n, 'suit': s };
				deck.push(card);
			});
		});
		shuffle(deck);
	
		//dividing cards
		let division = Math.floor(deck.length / this.members.length);
		for (let i = 0; i < this.members.length; i++) {
	
			let start = i * division, end;
			if (i == this.members.length - 1) end = deck.length; //for last user select all remaining cards
			else end = ((i + 1) * division);
	
			//store on server side
			let temp = deck.slice(start, end);
			temp.forEach(card => { this.members[i].cards.push(card); });
			//send to client side
			sockets.get(this.members[i].uId).emit("cardsReceived", temp);
			io.to(this.membersRoom).emit("updatedNoOfCards",
				{
					count: this.members[i].cards.length,
					id: sockets.get(this.members[i].uId).id
				}
			);
	
			// determine starter of the game
			if (this.starterIndex == undefined && this.members[i].hasAceOfSpades())
				this.starterIndex = i;
		}
	}
	startTheGame() {
		this.turnHolder = this.starterIndex;
		console.log("starter: " + this.turnHolder);
	
		io.to(this.activeMembersRoom).emit("disableAll");
		for (let j = 0; j < this.members.length; j++) {
			io.to(this.activeMembersRoom).emit("status", { id: sockets.get(this.members[j].uId).id, status: "playing" });
		}
		
		this.turn(); //first turn
	}
	turn() {
	
		this.turnUId = this.members[this.turnHolder].uId;    //user_id of person whose turn is this
		this.turnSocket = sockets.get(this.turnUId);         //socket of person whose turn is this

		this.turnSocket.emit("message", "Your TURN ...");
		this.turnSocket.to(this.activeMembersRoom).emit("message", "... Not Your TURN ...");

		this.setValidityOfCards();

		if (this.firstTurn) { // happens only in first turn 
			this.firstTurn = false;
			this.handleThrownCard({ number: 'A', suit: '♠' });
		}
		else {
			//start listening for take Card option
			this.turnSocket.emit("turnOnTakeCards");

			this.turnSocket.on("takeCards", () => {
				let targetMIndex = this.findNextActiveMember(this.turnHolder); 
				let targetUId = this.members[targetMIndex].uId;

				let temp = [];
				for (let i = 0; i < this.members[targetMIndex].cards.length; i++){
					let card = this.members[targetMIndex].cards[i];
					this.members[this.turnHolder].cards.push(card);          // add cards to turnHolder's account
					temp.push(card);
				}
				this.members[targetMIndex].cards.splice(0, this.members[targetMIndex].cards.length); // remove all cards of target 
				sockets.get(targetUId).emit("removeAllCards");
				sockets.get(targetUId).emit("message", "Previous player has taken your cards, So you have won");

				// add cards to turnHolders account on client side
				this.turnSocket.emit("addCards", temp);
				this.turnSocket.emit("disableAll");
				this.setValidityOfCards();


				//updated count of next user
				io.to(this.membersRoom).emit("updatedNoOfCards",
					{
						count: this.members[targetMIndex].cards.length,
						id: sockets.get(targetUId).id
					});
				// won status for next player
				io.to(this.membersRoom).emit("status", { id: sockets.get(targetUId).id, status: "won" });
				//updated count of current user
				io.to(this.membersRoom).emit("updatedNoOfCards",
					{
						count: this.members[this.turnHolder].cards.length,
						id: this.turnSocket.id
					}
				);
				// make target user inactive
				this.members[targetMIndex].isActive = false;
				sockets.get(targetUId).leave(this.activeMembersRoom);
			});
			
			//wait for user input
			this.turnSocket.on('cardThrown', thrownCard => {

				//stop listening for take Card option
				this.turnSocket.emit("turnOffTakeCards");
				this.turnSocket.removeAllListeners("takeCards");

				//go on
				this.handleThrownCard(thrownCard);
			});
		}
	}
	setValidityOfCards() {      //some code wrapped in function, to be used more than once	
		if (this.pile.length == 0)	this.validSuits = ['♥', '♦', '♣', '♠'];
		else {
			//valid suit is the suit of first card in the pile
			this.validSuits = [this.pile[0].card.suit];
			//check if currUser does not have this suit
			if (!this.members[this.turnHolder].hasSuit(this.validSuits[0])) {
				this.validSuits = ['♥', '♦', '♣', '♠'];
				if (!this.ignoreThola) this.tholaProgram = true;
			}
			else this.tholaProgram = false;
		}
		//enable cards for current user
		if (this.validSuits.length == 1) this.turnSocket.emit("enable", this.validSuits[0]);
		else this.turnSocket.emit("enable", "all");
	}
	handleThrownCard(thrownCard) {
		if (this.validSuits.indexOf(thrownCard.suit) != -1) {
			//disable cards for user
			this.turnSocket.emit("disableAll");
			this.turnSocket.removeAllListeners('cardThrown');
	
			//update cards at server
			removeFromArray(this.members[this.turnHolder].cards, thrownCard);
			//update cards count to all users
			io.to(this.membersRoom).emit("updatedNoOfCards",
				{
					count: this.members[this.turnHolder].cards.length,
					id: this.turnSocket.id
				});
			//send this card to all users
			let newObj = { 'sender': this.turnSocket.id, 'card': thrownCard };
			io.to(this.membersRoom).emit("itWasThrownBySomeone", newObj);
			// this.highest
			if (!this.tholaProgram) {
				if (this.highest == -1) {
					this.highest = this.turnHolder;
				}
				else {
					if (significance.get(thrownCard.number) > significance.get(this.cardNumberOfHighestMember())) {
						this.highest = this.turnHolder;
					}
				}
			}
			//add thrown card to this.pile
			this.pile.push({ memberIndex: this.turnHolder, card: thrownCard });
			// thola
			if (this.tholaProgram) {
				io.to(this.activeMembersRoom).emit("message", "THOLA");
				//wait a second
				setTimeout(() => {

					//add pile cards to this.highest's account
					let temp = [];
					for (let a = 0; a < this.pile.length; a++) {
						this.members[this.highest].cards.push(this.pile[a].card); //on server side
						temp.push(this.pile[a].card);
					}
					sockets.get(this.members[this.highest].uId).emit("addCards", temp); //on client side
					sockets.get(this.members[this.highest].uId).emit("disableAll");
	
					//update cards count for every user
					io.to(this.membersRoom).emit("updatedNoOfCards",
						{
							count: this.members[this.highest].cards.length,
							id: sockets.get(this.members[this.highest].uId).id
						}
					);
					
					//empty this.pile
					this.pile.splice(0, this.pile.length);                //on server side
					io.to(this.membersRoom).emit("emptyPile");  //on client side

					this.turnHolder = this.highest;          //next this.turnHolder

					// check if anyone has won
					for (let v = 0; v < this.members.length; v++) {
						let target = this.members[v];
						if (target.isActive && target.cards.length == 0) {
							sockets.get(target.uId).emit("message", "You have won");
							io.to(this.membersRoom).emit("status", { id: sockets.get(target.uId).id, status: "won" });
							target.isActive = false;
							sockets.get(target.uId).leave(this.activeMembersRoom);
						}
					}

					//reset variables
					this.highest = -1;
					this.tholaProgram = false;

					//if there is only one member left 
					if (this.countActiveMembers() == 1) {
						let loserIndex = this.findLoser();
						let loserSocket = sockets.get(this.members[loserIndex].uId);
						loserSocket.emit("disableAll");
						loserSocket.emit("message", "You have lost the game");
						io.to(this.membersRoom).emit("status", { id: loserSocket.id, status: "Bhabi/Loser" });
						this.members[loserIndex].isActive = false;
						loserSocket.leave(this.activeMembersRoom);
						//game ends
					}
					else this.turn(); //next turn
				}, 1000);
			}
			// if a round is complete
			else if (this.pile.length >= this.countActiveMembers()) {
				if (this.ignoreThola) this.ignoreThola = false; // stop ignoring tholas after first round is complete
				setTimeout(() => {
					// if anyone has won
					for (let v = 0; v < this.members.length; v++) {
						let target = this.members[v];
						if (target.isActive && target.cards.length == 0) {
	
							removeFromPileCardOf(v);//remove his card from this.pile so that this.highest from the rest can be found
							this.highest = findHigestPersonFromPile();
	
							sockets.get(target.uId).emit("message", "You have won");
							io.to(this.membersRoom).emit("status", { id: sockets.get(target.uId).id, status: "won" });
							target.isActive = false;
							sockets.get(target.uId).leave(this.activeMembersRoom);
						}
					}
	
					//empty pile
					this.pile.splice(0, this.pile.length);              // on server side
					io.to(this.membersRoom).emit("emptyPile");// on client side

					this.turnHolder = this.highest; // set next turn holder
					this.highest = -1;          // reset

					//if there is only one member left 
					if (this.countActiveMembers()==1) {
						let loserIndex = this.findLoser();
						let loserSocket = sockets.get(this.members[loserIndex].uId);
						loserSocket.emit("disableAll");
						loserSocket.emit("message", "You have lost the game");
						io.to(this.membersRoom).emit("status", { id: loserSocket.id, status: "Bhabi/Loser" });
						this.members[loserIndex].isActive = false;
						loserSocket.leave(this.activeMembersRoom);
					}
					else this.turn();
				}, 1000);
			}
			// regular next turn
			else {
				this.turnHolder = this.findNextActiveMember(this.turnHolder);
				this.turn();
			}
		}
	}
	findNextActiveMember(curr) {
		let max = this.members.length;
		for (let i = 1; i < max; i++){ //loop starts from 1 because we have to find next person not current one again
			let target = curr + i;
			if(target >= max) target = mod(target,max);
			if (this.members[target].isActive) return target;
		}
		return -1;
	}
	countActiveMembers() {
		let count = 0;
		for (let i = 0; i < this.members.length; i++)
			if (this.members[i].isActive) {
				count++;
			}
		return count;
	}
	removeFromPileCardOf(someone) {
		for (let i = 0; i < this.pile.length; i++){
			if (this.pile[i].memberIndex == someone) {
				this.pile.splice(i, 1);
				return true;
			}
		}
		return false;
	}
	findHigestPersonFromPile() {
		let highest = -1, highestCard = 0;
		for (let i = 0; i < this.pile.length; i++){
			if (significance.get(this.pile[i].card.number)>highestCard) {
				highestCard = this.pile[i].card.number;
				highest = this.pile[i].memberIndex;
			}
		}
		return highest;
	}
	cardNumberOfHighestMember() {
		for (let i = 0; i < this.pile.length; i++){
			if (this.pile[i].memberIndex == this.highest) {
				return this.pile[i].card.number;
			}
		}
	}
	findLoser() {
		for (let n = 0; n < this.members.length; n++)
			if (this.members[n].isActive)
				return n;
		return -1;
	}
};
class Users extends Map{
	static counter = 0;
	add(user) {
		super.set(++Users.counter, user);        //add in map
		return Users.counter;                    //return index
	}
};
class User{
	game;
	constructor(name) {
		this.name = name;
	}
};
class GameMember{
	cards = [];
	isActive = true;
	constructor(userID) {
		this.uId = userID;
	}
	hasAceOfSpades() {
		for (let i = 0; i < this.cards.length; i++){
			let card = this.cards[i];
			if (card.number == 'A' && card.suit == '♠')
				return true;
		}
		return false;
	}
	hasSuit(validOne) {
		for (let i = 0; i < this.cards.length; i++)
			if (this.cards[i].suit == validOne)
				return true;
		return false;
	}
};
var games = new Games();
var users = new Users();
var sockets = new Map();

io.on('connection', socket => {
	socket.on("username", username => {
		var myUId = users.add(new User(username));  //save user and obtain its user_id
		sockets.set(myUId,socket);                  //save socket
		let newMember = new GameMember(myUId);
		let lastGameId = games.size == 0 ? -1 : [...games][games.size - 1][0];
		if (lastGameId == -1 || games.get(lastGameId).hasBegun || games.get(lastGameId).members.size == maxMembers) { //if lastGame is unavailable to join
			let newGame = new Game();
			var myMIndex = newGame.addMember(newMember); // its index in members array 
			users.get(myUId).game = games.add(newGame);		
		}
		else{
			var myMIndex = games.get(lastGameId).addMember(newMember); // its index in members array
			users.get(myUId).game = lastGameId;
		}
		var gId = users.get(myUId).game;     //game_id

		socket.emit("meAdded", { user: users.get(myUId), id: socket.id, index: myMIndex }, (response) => { // acknowledgement func is called when other side has processed this emit event
			//join rooms
			socket.join(games.get(gId).membersRoom);
			socket.join(games.get(gId).activeMembersRoom);
			//tell everyone except this user that it has been added
			socket.to(games.get(gId).membersRoom).emit("aUserAdded", { user: users.get(myUId), id: socket.id, index: myMIndex });
			//tell this user about existing users
			for (let i = 0; i < games.get(gId).members.length; i++) {
				let uId = games.get(gId).members[i].uId;
				let memberID = sockets.get(uId).id;
				if (memberID != socket.id) {
					socket.emit("aUserAdded", { user: users.get(uId), id: memberID, index: i }); 
				}
			}
			//manual game start button
			if (games.get(gId).members.length == minMembers) io.to(games.get(gId).membersRoom).emit("awakeStartBtn"); 
			//automatic game start
			if (games.get(gId).members.length == maxMembers) {
				io.to(games.get(gId).membersRoom).emit("log", "Game is going to start.");
				socket.emit("gameIsStarting");
			}
			socket.on("startTheGame", () => {
				if (games.get(gId).hasBegun) socket.emit("log", "Game has already Begun !!!!!");
				else {
					games.get(gId).hasBegun = true;
					io.to(games.get(gId).membersRoom).emit("log", "Game has Begun...");
					games.get(gId).divideCards();
					games.get(gId).startTheGame();
				}
			});
		});
	});
});
function removeFromArray(array, toBeRemoved) { //removes card in an array of Cards
	const index = findIndexOfCard(toBeRemoved,array);
	if (index > -1) {
		array.splice(index, 1);
	}
}
function findIndexOfCard(obj, arr) { //searches card in an array of Cards
	for (let i = 0; i < arr.length; i++)
		if (arr[i].number == obj.number && arr[i].suit == obj.suit)
			return i;
	return -1;
}
function findInt(str) { //source: stack_overflow
	var matches = str.match(/(\d+)/);	
	if (matches) { return matches[0]; }
	else return false;
}
function shuffle(array) { //source: stack_overflow
	var currentIndex = array.length, randomIndex;

	// While there remain elements to shuffle...
	while (currentIndex != 0) {

		// Pick a remaining element...
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex--;

		// And swap it with the current element.
		[array[currentIndex], array[randomIndex]] = [
			array[randomIndex], array[currentIndex]];
	}

	return array;
}
function mod(n, m) { // performs n mod m (source: stack_overflow)
  return ((n % m) + m) % m;
}