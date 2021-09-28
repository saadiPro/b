const socket = io();

watchForChangesInMyCardsAndApplyStyles();

//cards values signinficance map
let significance = new Map();
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

let username = '';
while(username === '')
	username = prompt("Enter a username:");
username = (username == null ? "UnNamed" : username);
socket.emit("username", username);

let myID;
socket.on('connect', () => myID = socket.id);

let idSlotMap = new Map(); //mapping of user slots # 1,2,3,4
var myIndexAtServer, takeCardsDisabled = true;

socket.on("meAdded", (userJSON,callback) => {
	var user = userJSON.user;
	let userSocketId = userJSON.id;
	myIndexAtServer = userJSON.index;
	var code = `<div class="imgWrapper"><img src="user.png" alt="USER"></div>
							<div class="name">${user.name}</div>
							<div class="noOfCards">Cards: 0</div>
							<div class="status">Status: Joined</div>
							<div id="takeCardsBtn" title="Take Cards from Player next to You"><button>Take Cards</button><div>`;

	idSlotMap.set(userSocketId, 1);
	let q = '#u' + 1;
	$(q).append(code);

	//callback for acknowledgment on the other side
	callback();

	//takeCards Button handling
	takeCardsToggle("disable");
	$(q).on('click', '#takeCardsBtn', () => {
		if (!takeCardsDisabled) {
			takeCardsDisabled = true;
			takeCardsToggle("disable");
			socket.emit("takeCards"); 
		}
	});
	socket.on("turnOnTakeCards",  () => { takeCardsDisabled = false; takeCardsToggle("enable"); });
	socket.on("turnOffTakeCards", () => { takeCardsDisabled = true; takeCardsToggle("disable"); });
});

socket.on("aUserAdded", (userJSON) => {
	var user = userJSON.user, index = userJSON.index;
	let userSocketId = userJSON.id;
	var code = `<div class="imgWrapper"><img src="user.png" alt="USER"></div>
							<div class="name">${user.name}</div>
							<div class="noOfCards">Cards: 0</div>
							<div class="status">Status: Joined</div>`;
	let pos = findPos(myIndexAtServer, index); //position on the table
	idSlotMap.set(userSocketId, pos);
	let q = '#u' + pos;
	$(q).append(code);
});

socket.on("log", (msg) => { log(msg); });         //logs a message from server on screen
socket.on("message", msg => { $('.message').html(msg); });   //displays a message for me from server
socket.on("awakeStartBtn", () => log('<button id="startBtn">Start Game</button>')); //gives a button to start the game in log
$("#log").on("click", "#startBtn", () => { socket.emit("startTheGame"); }); //gameStart by choice
socket.on("gameIsStarting", () => { socket.emit("startTheGame"); });        //gameStart automatically


socket.on("cardsReceived", cards => {
	console.log(cards);
	let code = '';
	cards.forEach(card => {
		code += '<div class="slot" data-number="'+card.number+'" data-suit="'+card.suit+'" style="cursor:pointer"><img src="../svg-cards/'+svgName(card.number,card.suit)+'"></div>';
	});
	$('#myCards').append(code);
	sortCards(); 
});
var currentlyEnabled='';
socket.on('disableAll', () => disableAll());          //disable all my cards
socket.on('enable', (selected) => enable(selected));  //enable selected my cards

socket.on("addCards", cards => { addCards(cards); });  //receive only mycards

socket.on("removeAllCards", () => $('#myCards').html('')); //remove all of my cards

//when I click on one of my Cards
$('#myCards').on('click', '.slot', (e) => {
	e.preventDefault();
	if (currentlyEnabled != '' && e.currentTarget.matches(currentlyEnabled)) { //do something only if this card is enabled
		let n = e.currentTarget.dataset.number;
		let s = e.currentTarget.dataset.suit;
		socket.emit("cardThrown", { 'number': n, 'suit': s });
	}
});


socket.on("updatedNoOfCards", obj => {                 //updates card count of given user
	let targetSlot = idSlotMap.get(obj.id);              // given user
	let selector = $('#u' + targetSlot + ' .noOfCards');
	selector.html("Cards: " + obj.count);                // update count
});

socket.on("status", obj => {                           //updates status of given user
	let targetSlot = idSlotMap.get(obj.id);              //given user
	let selector = $('#u' + targetSlot + ' .status');
	selector.html("Status: " + obj.status);              //update status
});

socket.on("itWasThrownBySomeone", obj => {    // when someone throws a card
	let targetSlot = idSlotMap.get(obj.sender); // get who sent it
	if (obj.sender == socket.id) {              // remove card from my cards if I am the throwed the card (I'm sender) 
		$('#myCards .slot[data-number="' + obj.card.number + '"][data-suit="' + obj.card.suit + '"]').remove();	
	}
	code = '<img data-number="' + obj.card.number + '" data-suit="' + obj.card.suit + '" src="../svg-cards/' + svgName(obj.card.number, obj.card.suit) + '" alt="userid">';
	$('#s' + targetSlot).append(code);            // add card in the pile
});

socket.on("emptyPile", () => { // clears out the pile
	console.log('empty pile called...');
	$('#s1').html('');
	$('#s2').html('');
	$('#s3').html('');
	$('#s4').html('');
});


/******************** FUNCTIONS ***************************/

function takeCardsToggle(option) { // enables or disables visually the button
	if (option == "disable") {
		$('#u1 #takeCardsBtn').css('filter', 'brightness(50%)');
		$('#u1 #takeCardsBtn').css('cursor', 'context-menu');
	}
	else if (option == "enable") {
		$('#u1 #takeCardsBtn').css('filter', 'brightness(100%)');
		$('#u1 #takeCardsBtn').css('cursor', 'pointer');
	}
}
function mod(n, m) { // performs n mod m
  return ((n % m) + m) % m;
}
function findPos(myIndex, newIndex) { //calculates position for newIndex relative to myIndex
	let diff = newIndex - myIndex;
	if (diff > 0) {
		return 1 + diff;
	}
	else if (diff < 0) {
		return mod(diff,4) +1;
	}
}
function log(msg) { //logs a message on the screen
	msg = '<div class="logMessage">' + msg + '</div>';
	$("#log").append(msg);
	$("#log").scrollTop($("#log")[0].scrollHeight);
}
function sortCards() { //sort cards in order
	//get all cards/slots
	let selector = $('#myCards .slot');
	let arr = [];
	for (let i = 0; i < selector.length; i++){
		arr[i] = {
			value: significance.get(selector[i].dataset.number),
			suit: selector[i].dataset.suit,
			code: selector[i].outerHTML
		};
	}
	arr.sort(compare); //sort
	//put back html
	let code = '';
	for (let i = 0; i < arr.length; i++) {
		code += arr[i].code;
	}
	$('#myCards').html(code);

	function compare(a, b) { //custom compare func for cards sort
		let suits = ['♥', '♣', '♦', '♠'];
		if (a.suit == b.suit) {
			if (a.value < b.value) return -1;
			else return 1;
		}
		else if (suits.indexOf(a.suit) < suits.indexOf(b.suit)) return -1;
		else return 1;
	}
}
function addCards(cards) { //adds new cards to my existing cards
	let code = '';
	cards.forEach(card => {
		code += '<div class="slot" data-number="' + card.number + '" data-suit="' + card.suit + '" style="cursor:pointer"><img src="../svg-cards/' + svgName(card.number, card.suit) + '"></div>';
	});
	$('#myCards').append(code);
	sortCards();

	//handle enabled/disbaled
	if (currentlyEnabled == '') {
		disableAll();
	}
	else if (currentlyEnabled.substr(0, 25) == '#myCards .slot[data-suit=') {
		let toBeEnabled = currentlyEnabled.substr(26, 1);
		disableAll();
		enable(toBeEnabled);
	}
}
function findInt(str) { // extracts integer from string
	var matches = str.match(/(\d+)/);	
	if (matches) { return matches[0]; }
	else return false;
}
function svgName(number, suit) { //finds name of svg file for asked card(number,suit)
	let partOne, partTwo;

	if (number == 'A') partOne = 'ace';
	else if (number == 'K') partOne = 'king';
	else if (number == 'Q') partOne = 'queen';
	else if (number == 'J') partOne = 'jack';
	else partOne = number;

	if (suit == '♥') partTwo = 'hearts';
	else if (suit == '♦') partTwo = 'diamonds';
	else if (suit == '♣') partTwo = 'clubs';
	else if (suit == '♠') partTwo = 'spades';

	return partOne + '_of_' + partTwo + '.svg';
}
function disableAll() {                      // disable all of my cards
	let s1 = '#myCards', s2 = '.slot';
	currentlyEnabled = '';
	$(s1+' '+s2).css('filter' , 'brightness(50%)');
	$(s1+' '+s2).css('cursor' , 'context-menu');
}
function enable(what) {                      // enables some or all of my cards
	let s1 = '#myCards', s2;
	if (what == 'all') { s2 = '.slot'; }
	else if (what == '♦'){ s2 = '.slot[data-suit="♦"]' }
	else if (what == '♥'){ s2 = '.slot[data-suit="♥"]'}
	else if (what == '♣'){ s2 = '.slot[data-suit="♣"]'}
	else if (what == '♠'){ s2 = '.slot[data-suit="♠"]'}
	currentlyEnabled = s1 + ' ' + s2;
	$(s1+' '+s2).css('filter' , 'brightness(100%)');
	$(s1+' '+s2).css('cursor' , 'pointer');
}
function watchForChangesInMyCardsAndApplyStyles() { // source : stackoverflow
	
	// Select the node that will be observed for mutations
	const targetNode = document.getElementById('myCards');

	// Options for the observer (which mutations to observe)
	const config = {childList: true/*, subtree: true*/ };

	// Callback function to execute when mutations are observed
	const callback = function(mutationsList, observer) {
			// Use traditional 'for loops' for IE 11
			for(const mutation of mutationsList) {
					if (mutation.type === 'childList') {
						selector = $('#myCards .slot');
						for (let i = 0; i < selector.length; i++){
							$(selector[i]).css('z-index', `${i + 1}`);
							$(selector[i]).css('transform', `translateX(${i*50}%)`);
						}
					}
			}
	};

	// Create an observer instance linked to the callback function
	const observer = new MutationObserver(callback);

	// Start observing the target node for configured mutations
	observer.observe(targetNode, config);

	// Later, you can stop observing
	// observer.disconnect();
}