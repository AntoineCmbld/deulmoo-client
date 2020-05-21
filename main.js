// const WS_REMOTE_URL = 'ws://localhost:8080/';
const WS_REMOTE_URL = 'wss://deulmoo.herokuapp.com/';

// ===========================
// ====== GLOBAL SOCKET ======
// ===========================

function getSocket() {

    if (this.ws) return this.ws;

    this.ws = new WebSocket(WS_REMOTE_URL);
    this.ws.onmessage = function (event) {
        const raw_payload = event.data;
        const payload = JSON.parse(raw_payload);
        updateQuestions(payload);
    }

    return ws;
}

// ============================
// ======== SCRAP DOM =========
// ============================

// Returns an Array and not HTMLCollection!
function getQuestionBlocks() {
    let question_blocks = document.getElementsByClassName("content");

    if (question_blocks.length < 2) {
        throw new Error("Incorrect number of content tags: " + question_blocks.length)
    }

    question_blocks = Array.from(question_blocks);
    question_blocks.pop(); // Last element is the question list, we remove it

    return question_blocks;
}

function getQuestionBlockQuestionHTML(question_block) {
    const question_text_dom = question_block.getElementsByClassName("qtext");

    if (question_text_dom.length !== 1) {
        throw new Error("Incorrect number of qtext tags: " + question_text_dom.length)
    }

    return question_text_dom[0].innerHTML;
}

function getQuestionBlockAnswersDOM(question_block) {
    const answer_block = question_block.getElementsByClassName('answer');

    if (answer_block.length !== 1) {
        throw new Error("Incorrect number of answer tags: " + answer_block.length)
    }

    return answer_block[0].getElementsByTagName('div');
}

function getQuestionBlockAnswersHTML(answer_block) {
    const label_tag = answer_block.getElementsByTagName('label');

    if (label_tag.length !== 1) {
        throw new Error("Incorrect number of answer label tags: " + label_tag.length)
    }

    return label_tag[0].innerHTML;
}

function getQuestionBlockAnswersInputDOM(answer_block) {
    const input_tag = answer_block.getElementsByTagName('input');

    if (input_tag.length !== 1) {
        throw new Error("Incorrect number of answer input tags: " + input_tag.length)
    }

    return input_tag[0];
}

async function getQuestionBlockFromDigest(digest) {
    const question_blocks = getQuestionBlocks();
    for (const qb of question_blocks) {
        const html = getQuestionBlockQuestionHTML(qb);
        const questionDigest = await digestMessage(html);
        if (questionDigest === digest) {
            return qb;
        }
    }
}

async function getAnswerBlockFromDigest(question_block, digest) {
    const answer_blocks = getQuestionBlockAnswersDOM(question_block);
    for (const ab of answer_blocks) {
        const html = getQuestionBlockAnswersHTML(ab);
        const answerDigest = await digestMessage(html);
        if (answerDigest === digest) {
            return ab;
        }
    }
}

// ===========================
// ====== SENDING DATA =======
// ===========================

function sendSelectedAnswers(questionDigest, answerDigests) {
    const message = JSON.stringify({
        question: questionDigest,
        answers: answerDigests,
        voter: getUniqueQuestioneeIdentifier()
    });

    getSocket().send(message);
}

// ===========================
// ======= VIEW UPDATE =======
// ===========================

function ensureCountDOMForAnwserDOM(answer_block) {
    const existing_dom = answer_block.getElementsByClassName("deulmoo-count-span");

    if (existing_dom.length <= 0) {
        // Create the counter DOM
        const span_dom = document.createElement('span');
        span_dom.className = 'deulmoo-count-span';
        setAnswerCountNumber(span_dom, '..')

        answer_block.appendChild(span_dom);
    }
}

function getCountDOMForAnswerDOM(answer_block) {
    // Never too sure!
    ensureCountDOMForAnwserDOM(answer_block);
    const existing_dom = answer_block.getElementsByClassName("deulmoo-count-span");
    if (existing_dom.length <= 0) {
        throw new Error('Could not find the counter..');
    }

    return existing_dom[0];
}

function setAnswerCountNumber(countDOM, value, prefix = ' ~ ') {
    countDOM.innerText = prefix + value;
}

function updateQuestions(payload) {
    Object.keys(payload).forEach(async key => {
        const questionDigest = key;
        const answers = payload[key];
        const question_block = await getQuestionBlockFromDigest(questionDigest);

        if (!question_block) {
            // console.log('Question block not found: ', questionDigest);
            return;
        }

        for (const a of answers) {
            Object.keys(a).forEach(async aKey => {
                const answerDigest = aKey;
                const answer_votes = a[aKey];
                const answer_block = await getAnswerBlockFromDigest(question_block, answerDigest);

                if (!answer_block) {
                    // console.log('Answer block not found: ', answerDigest);
                    return;
                }

                const answer_counter_block = getCountDOMForAnswerDOM(answer_block);
                setAnswerCountNumber(answer_counter_block, answer_votes);
            }) 
        }
    })
}

function toggleCountersVisible() {
    const counters = document.getElementsByClassName("deulmoo-count-span");
    
    for (const c of counters) {
        c.style.display = c.style.display === "" ? "none" : "";
    }
}

// ===========================
// ========= DIGEST ==========
// ===========================

// Source: MDN
async function digestMessage(message) {
    const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);           // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
    return hashHex;
}

// ===========================
// ====== URI PARSING ========
// ===========================

/**
 * Get the URL parameters
 * source: https://css-tricks.com/snippets/javascript/get-url-variables/
 * @param  {String} url The URL
 * @return {Object}     The URL parameters
 */
function getParams(url) {
	const params = {};
	const parser = document.createElement('a');
	parser.href = url;
	const query = parser.search.substring(1);
	const vars = query.split('&');
	for (let i = 0; i < vars.length; i++) {
		const pair = vars[i].split('=');
		params[pair[0]] = decodeURIComponent(pair[1]);
	}
	return params;
}

function getUniqueQuestioneeIdentifier() {
    return getParams(location.href).attempt;
}
  
// ============================
// ========= MAIN =============
// ============================

function main() {
    getSocket(); // Will leave time for ws singleton to connect
    const question_blocks = getQuestionBlocks();
    
    // Main initialization loop. It will get the question input and attach event 
    // listeners to them so you can submit your choices.
    // It will also create the DOM for the vote counter next to each answer
    for (const qb of question_blocks) {
        const answers = getQuestionBlockAnswersDOM(qb);
        const qhtml = getQuestionBlockQuestionHTML(qb);
    
        
        for (const a of answers) {
            // Create the count span for the answer
            ensureCountDOMForAnwserDOM(a);
            
            // We implement here the callback function since we use variables from the higher scope
            // When an input changes state, we re-send the values from the whole question block
            const fChangeCallback = (event) => {
                const pQuestionDigest = digestMessage(qhtml);
                const aCheckedSiblingsDigests = [];
                for (const sibling of answers) {
                    const input = getQuestionBlockAnswersInputDOM(sibling);
                    
                    if (input.checked) {
                        const siblingHtml = getQuestionBlockAnswersHTML(sibling);
                        aCheckedSiblingsDigests.push(digestMessage(siblingHtml))
                    }
                }

                Promise
                    .all([pQuestionDigest, ...aCheckedSiblingsDigests])
                    .then(digests => {
                        
                        const questionDigest = digests[0];
                        const answerDigests = digests.slice(1);

                        sendSelectedAnswers(questionDigest, answerDigests);
                    });
            }

            const input = getQuestionBlockAnswersInputDOM(a);

            switch (input.type) {
                case "radio":
                case "checkbox":
                    input.addEventListener('change', fChangeCallback);
                    break;

                default:
                    console.warn('Unsupported input type: ' + input.type);
            }
        }        

    } // => end of main init loop

    // We want the ability to hide the graph, if we hit a the $ key
    document.onkeypress = function (e) {
        e = e || window.event;
        if (e.keyCode === 36) {
            toggleCountersVisible();
        }
    };
}

main();