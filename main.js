// const WS_REMOTE_URL = 'ws://localhost:8080/';
const WS_REMOTE_URL = 'wss://deulmoo.herokuapp.com/';

// ===========================
// ====== GLOBAL SOCKET ======
// ===========================

function getSocket() {

    const fSocketAsPromise = () => {
        return new Promise((resolve, reject) => {
            this.working = true;
            const ws = createNewSocket(WS_REMOTE_URL);
            ws.onopen = () => {
                // console.log("WS opened or reopened");
                this.working = false;
                resolve(ws);
            };

            ws.onerror = (e) => {
                console.warn("[Deulmoo] WS encounetred an error: ", e);
                this.working = false;
                reject(ws);
            };
        });
    }

    if (this.working) {
        return this.promise;
    }

    if (this.ws) {
        switch (this.ws.readyState) {
            case WebSocket.CLOSED:
            case WebSocket.CLOSING:
                return this.promise = fSocketAsPromise().then(ws => this.ws = ws);
            
            default:
                return Promise.resolve(this.ws);
        }
    }

    return this.promise = fSocketAsPromise().then(ws => this.ws = ws);
}

function createNewSocket(remote_url) {
    const ws = new WebSocket(WS_REMOTE_URL);
    
    ws.onmessage = function (event) {
        const raw_payload = event.data;
        const payload = JSON.parse(raw_payload);
        updateQuestions(payload);
    };

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

    return answer_block[0].children;
}

function getQuestionBlockAnswersHTML(answer_block) {
    const label_tag = answer_block.getElementsByTagName('label');

    if (label_tag.length !== 1) {
        throw new Error("Incorrect number of answer label tags: " + label_tag.length)
    }

    /**
     * The trick is, we have HTML like this
     * <label for="q86:2_answer1" class="ml-1"><span class="answernumber">b. </span>a day</label>
     * And in this example, we only want to return "a day" without the "answernumber"
     * 
     * We can also have monstrosities like so 
     * <label for="q269633:31_answer0" class="ml-1">
     *  <span class="answernumber">a. </span>
     *  Some text<br>
     *  <div class="editor-indent">
     *      <span style="font-size: 0.9375rem;">More text</span>
     *  </div>
     * </label>
     * 
     * in which case we want to return "Some textMore text"
     * 
     * The only drawback of doing so is that if a node doesn't contain text at all (eg: pick an image)
     * innerText will be empty everytime resulting in the same digest.
     * 
     * UPDATE: to counter this issue, I decided to return the full innerHTML but with the .answernumber
     * tag removed
     * 
     */

    const cp = document.createElement('span');
    cp.innerHTML = label_tag[0].innerHTML;
    cp.querySelectorAll('.answernumber').forEach(an => an.remove());

    return cp.innerHTML;
}

function getQuestionBlockAnswersInputDOM(answer_block) {
    // Sometimes, whn the answer is not a radio or checkbox choice, we can be given an input directly
    // in this case, this is an expected situation, so we just return null to indicate we must move on
    // and skip the block
    if (answer_block.tagName !== 'DIV') {
        return null;
    }

    const input_tag = answer_block.getElementsByTagName('input');

    if (input_tag.length !== 1) {
        throw new Error("Incorrect number of answer input tags: " + input_tag.length)
    }

    return input_tag[0];
}

async function getQuestionBlockFromDigest(digest) {
    const question_blocks = getQuestionBlocks();
    for (const qb of question_blocks) {
        let html, questionDigest;
        
        try {
            html = getQuestionBlockQuestionHTML(qb);
            questionDigest = await digestMessage(html);
        } catch (e) {
            console.warn(e);
            console.log("Ignoring question block", qb);
            continue;
        }

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

    getSocket().then(ws => ws.send(message));
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
    const question_blocks = getQuestionBlocks();
    
    // Main initialization loop. It will get the question inputs and attach event 
    // listeners to them so you can submit your choices.
    // It will also create the DOM for the vote counter next to each answer
    for (const qb of question_blocks) {
        let answers, qhtml;

        try {
            answers = getQuestionBlockAnswersDOM(qb);
            qhtml = getQuestionBlockQuestionHTML(qb);
        } catch (e) {
            console.warn("Deulmoo error on init: ", e);
            console.log("Skipping question block as a result:", qb);
            continue;
        }
        
        for (const a of answers) {
            
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

            // Create the count span for the answer
            ensureCountDOMForAnwserDOM(a);

            const input = getQuestionBlockAnswersInputDOM(a);

            if (input === null) {
                // This is not a QCM, but a text field or other
                console.log("Unsupported question type", qb);
                continue;
            }
            
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

    // Will open a connection. When connected, will show the poll's current statistics
    getSocket();
}

main();