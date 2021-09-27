// const WS_REMOTE_URL = 'ws://localhost:8080/';
const WS_REMOTE_URL = 'wss://deulmoo.herokuapp.com/';

// ===========================
// ====== GLOBAL SOCKET ======
// ===========================

function getSocket() {

    const fSocketAsPromise = () => {
        return new Promise(async (resolve, reject) => {
            this.working = true;
            const ws = await createNewSocket(WS_REMOTE_URL);
            ws.onopen = () => {
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

// Creates a new Websocket with the subscriptions to the currently displayed questions
// Only onmessage event handled to update. Not necessarily OPEN
// async because it needs to digest all questions on page first
async function createNewSocket(remote_url) {
    const question_blocks = getQuestionBlocks();
    const topics = [];

    for (const qb of question_blocks) {
        try {
            const qb_hash = await digestMessage(getQuestionBlockQuestionHTML(qb));
            topics.push(qb_hash);
        } catch (e) {
            console.log("No question text. Skipping.", qb);
        }
    }

    const ws = new WebSocket(WS_REMOTE_URL + '?topics=' + topics.join(','));

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
    const div_tag = answer_block.querySelectorAll('.answernumber + div')
    const div2_tag = answer_block.querySelectorAll("div[data-region=answer-label]")

    if (label_tag.length === 1) {
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
    else if (div_tag.length === 1) {
        return div_tag[0].outerHTML
    }
    else if (div2_tag.length === 1) {
        return div2_tag[0].outerHTML
    }
    else {
        console.error('The following error is about this block', answer_block)
        throw new Error('Could not extract html from question block')
    }

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
            continue;
        }

        if (questionDigest === digest) {
            return qb;
        }
    }
}

function getAnswerBlockFromDigest(question_block, digest) {
    const answer_blocks = getQuestionBlockAnswersDOM(question_block);
    for (const ab of answer_blocks) {
        if (getCountDOMForAnswerDOM(ab).dataset.ad === digest) {
            return ab
        }
    }
}

// ===========================
// ====== SENDING DATA =======
// ===========================

function sendSelectedAnswers(question_digest, answer_digests) {
    const message = JSON.stringify({
        question: question_digest,
        answers: answer_digests,
        vote_type: 'vote',
        voter: getUniqueQuestioneeIdentifier()
    });

    getSocket().then(ws => ws.send(message));
}

function sendToggleVote(node, vote_type) {
    const question_digest = node.parentNode.dataset['qd'];
    const answer_digest = node.parentNode.dataset['ad'];
    const message = JSON.stringify({
        question: question_digest,
        answer: answer_digest,
        vote_type,
        voter: getUniqueQuestioneeIdentifier()
    });

    getSocket().then(ws => ws.send(message));
}

// ===========================
// ======= VIEW UPDATE =======
// ===========================

function ensureCountDOMForAnwserDOM(answer_block, pqhtml_digest, pahtml_digest) {
    const existing_dom = answer_block.getElementsByClassName("deulmoo-count-span");

    if (existing_dom.length <= 0) {
        // Create the counter DOM
        const span_dom = document.createElement('span');
        span_dom.className = 'deulmoo-count-span';
        span_dom.style['white-space'] = 'pre';
        span_dom.dataset['vote'] = '0';
        span_dom.dataset['upvote'] = '0';
        span_dom.dataset['downvote'] = '0';
        setAnswerCounterDisplayValue(span_dom, '0 votes');

        pqhtml_digest.then(qd => span_dom.dataset['qd'] = qd);
        pahtml_digest.then(ad => span_dom.dataset['ad'] = ad);

        answer_block.appendChild(span_dom);

        // Update display everytime the dataset is updated
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach((mutation) => {
                if (mutation.type == "attributes") {
                    updateAnswerCounterDisplayValueFromDataset(mutation.target);
                }
            });
        });

        // Exclude CSS changes & assume digests will be ready
        observer.observe(span_dom, {
            attributes: true,
            attributeFilter: [
                'data-vote',
                'data-upvote',
                'data-downvote'
            ]
        });


    }
}

function getCountDOMForAnswerDOM(answer_block) {
    const existing_dom = answer_block.getElementsByClassName("deulmoo-count-span");
    if (existing_dom.length <= 0) {
        throw new Error('Could not find the counter..');
    }

    return existing_dom[0];
}

function setAnswerCounterDisplayValue(countDOM, value, prefix = ' is ') {
    countDOM.innerText = prefix + value;
}

function updateAnswerCounterDisplayValueFromDataset(countDOM, prefix = ' is ') {
    const vote_node = document.createElement('span');
    vote_node.innerText = prefix + countDOM.dataset.vote + ' ';

    const upvote_node = document.createElement('span');
    upvote_node.innerText = countDOM.dataset.upvote + '↑';
    upvote_node.onclick = e => sendToggleVote(e.target, 'upvote');

    const downvote_node = document.createElement('span');
    downvote_node.innerText = countDOM.dataset.downvote + '↓';
    downvote_node.onclick = e => sendToggleVote(e.target, 'downvote');


    countDOM.innerHTML = '';
    countDOM.appendChild(vote_node);
    countDOM.appendChild(upvote_node);
    countDOM.appendChild(downvote_node);
}

// Attributes is an object, which keys will be mapped to the data- attribute
function setAnswerCounterDataAttributes(countDOM, attributes) {
    Object.keys(attributes).forEach(key => {
        const value = attributes[key];

        // Try triggering as few events as possible
        if (countDOM.dataset[key] !== value) {
            countDOM.dataset[key] = value;
        }
    });
}

function updateQuestions(payload) {
    Object.keys(payload).forEach(async key => {
        const question_digest = key;
        const answers = payload[key];
        const question_block = await getQuestionBlockFromDigest(question_digest);

        if (!question_block) {
            return;
        }

        for (const a of answers) {
            Object.keys(a).forEach(async aKey => {
                const answer_digest = aKey;
                const answer_block = getAnswerBlockFromDigest(question_block, answer_digest);
                const answer_votes = a[aKey].split(',');

                if (!answer_block) {
                    return;
                }

                if (answer_votes.length !== 3) {
                    console.warn("Received vote count not well formatted", a[aKey]);
                    return;
                }

                const vote_types = {
                    vote: answer_votes[0],
                    upvote: answer_votes[1],
                    downvote: answer_votes[2]
                };

                const answer_counter_block = getCountDOMForAnswerDOM(answer_block);
                setAnswerCounterDataAttributes(answer_counter_block, vote_types);
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
    // Uncomment this to emulate multiple accounts on one PC

    // function getRandomInt(max) {
    //     return Math.floor(Math.random() * Math.floor(max));
    //   }
    //   if (!this.dbg) this.dbg = '' + getRandomInt(100);
    // return this.dbg;

    return getParams(location.href).attempt;
}

// ============================
// ========= MAIN =============
// ============================

function main() {
    // Quick css mod. Avoids having the vote text stuck to the right
    document.querySelectorAll("label.w-100, div[data-region].w-100").forEach(l => l.classList.remove("w-100"));

    const question_blocks = getQuestionBlocks();

    // Main initialization loop. It will get the question inputs and attach event 
    // listeners to them so you can submit your choices.
    // It will also create the DOM for the vote counter next to each answer
    for (const qb of question_blocks) {
        let answers, qhtml, pqhtml_digest;

        try {
            answers = getQuestionBlockAnswersDOM(qb);
            qhtml = getQuestionBlockQuestionHTML(qb);
            pqhtml_digest = digestMessage(qhtml);
        } catch (e) {
            console.warn("Could not process question", e);
            continue;
        }

        for (const a of answers) {

            // We implement here the callback function since we use variables from the higher scope
            // When an input changes state, we re-send the values from the whole question block
            const fChangeCallback = (event) => {
                const aCheckedSiblingsDigests = [];
                for (const sibling of answers) {
                    const input = getQuestionBlockAnswersInputDOM(sibling);

                    if (input.checked) {
                        aCheckedSiblingsDigests.push(getCountDOMForAnswerDOM(sibling).dataset.ad)
                    }
                }

                pqhtml_digest.then(qd => {
                    sendSelectedAnswers(qd, aCheckedSiblingsDigests);
                })
            }

            // For each answer (checkbox or radio) of the question block, we attach the callback
            // which will go and check every other answer of the block
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
                    continue;
            }

            // Create the count span for the answer
            // We need to get the question & answer digests to put them in the dataset
            // the delay should be relatively short, and it doesn't matter if other events
            // finish first
            const ahtml = getQuestionBlockAnswersHTML(a);
            const pahtml_digest = digestMessage(ahtml);
            ensureCountDOMForAnwserDOM(a, pqhtml_digest, pahtml_digest);
        }

    } // => end of main init loop

    // We want the ability to hide the graph, if we hit a the $ key
    document.body.onclick = document.onkeypress = function (e) {
        e = e || window.event;
        if (e.keyCode === 36 || (e.which == 1 && e.pageX < 100) ) {
            toggleCountersVisible();
        }
    };

    // Will open a connection. When connected, will show the poll's current statistics
    getSocket();
}

main();