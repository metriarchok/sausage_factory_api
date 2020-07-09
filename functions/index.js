const functions = require('firebase-functions');
const fetch = require('node-fetch');
const express = require('express');
const Firestore = require('@google-cloud/firestore');
const jsonDiff = require('json-diff');
const bodyParser = require('body-parser');
const app = express();
const PROJECTID = '';

const firestore = new Firestore({
  projectId: PROJECTID,
  timestampsInSnapshots: true
});

const legiscanUrl = 'https://api.legiscan.com/?key=' + process.env.KEY;

function getDiff(b1, b2) {
  const d = jsonDiff.diff(b1, b2);
  var diffResult = [];
  if (d != undefined && d != null) {
    d.map((e, i) => {
      if (e[1] != undefined) {
        diffResult.push(e[1]);
      }
    });
  }
  return diffResult;
}

function getFeedEvents(billNew, billOld) {
  let bill = billOld || {
    history: [],
    progress: [],
    calendar: [],
    texts: [],
    votes: [],
    amendments: []
  };

  cmp = function (a, b) {
    if (a > b) return +1;
    if (a < b) return -1;
    return 0;
  };

  const lastAction = billNew['history'] ? billNew['history'][billNew['history'].length - 1] : null;
  const { last_action_date, last_action } = billNew['history']
    ? { last_action_date: lastAction.date, last_action: lastAction.action }
    : { last_action_date: new Date(), last_action: '[created]' };
  let history = billNew['history'] != undefined ? getDiff(bill['history'], billNew['history']) : [];
  let progress = billNew['progress'] != undefined ? getDiff(bill['progress'], billNew['progress']) : [];
  let calendar = billNew['calendar'] != undefined ? getDiff(bill['calendar'], billNew['calendar']) : [];
  let texts = billNew['texts'] != undefined ? getDiff(bill['texts'], billNew['texts']) : [];
  let votes = billNew['votes'] != undefined ? getDiff(bill['votes'], billNew['votes']) : [];
  let amendments = billNew['ammendments'] != undefined ? getDiff(bill['amendments'], billNew['ammendments']) : [];

  const progressEvents = {
    1: 'Introduced',
    2: 'Engrossed',
    3: 'Enrolled',
    4: 'Passed',
    5: 'Vetoed',
    6: 'Failed',
    7: 'Override',
    8: 'Chaptered',
    9: 'Refer',
    10: 'Report Pass',
    11: 'Report DNP',
    12: 'Draft'
  };
  var timeline = [];

  if (typeof history != 'undefined') {
    const len = bill.history.length;
    history.map((i, index) =>
      timeline.push({
        date: i['date'],
        id: 'hi-' + (index + len).toString(),
        typeIndex: index,
        eventType: 'history',
        title: i['action'],
        description: '',
        chamber: i['chamber'],
        data: i
      })
    );
  }
  if (typeof calendar != 'undefined') {
    const len = bill.calendar.length;
    calendar.map((i, index) =>
      timeline.push({
        date: i['date'],
        id: 'ca-' + (index + len).toString(),
        typeIndex: index,
        eventType: 'calendar',
        title: i['type'],
        description: i['description'],
        chamber: '',
        data: i
      })
    );
  }
  if (typeof amendments != 'undefined') {
    const len = bill.amendments.length;
    amendments.map((i, index) =>
      timeline.push({
        date: i['date'],
        id: 'am-' + (index + len).toString(),
        typeIndex: index,
        eventType: 'amendment',
        title: i['title'],
        description: i['description'],
        chamber: i['chamber'],
        data: i
      })
    );
  }
  if (typeof progress != 'undefined') {
    const len = bill.progress.length;
    progress.map((i, index) =>
      timeline.push({
        date: i['date'],
        id: 'pr-' + (index + len).toString(),
        typeIndex: index,
        eventType: 'progress',
        title: progressEvents[i['event']],
        description: '',
        chamber: '', //todo: lookup chamber
        data: i
      })
    );
  }
  if (typeof texts != 'undefined') {
    const len = bill.texts.length;
    texts.map((i, index) =>
      timeline.push({
        date: i['date'],
        id: 'tx-' + (index + len).toString(),
        typeIndex: index,
        eventType: 'text',
        title: i['type'],
        description: i['url'],
        chamber: '', //todo: lookup chamber
        data: i
      })
    );
  }
  if (typeof votes != 'undefined') {
    const len = bill.votes.length;
    votes.map((i, index) =>
      timeline.push({
        date: i['date'],
        id: 'vo-' + (index + len).toString(),
        typeIndex: index,
        eventType: 'vote',
        title: i['passed'] == '1' ? i['desc'] + ' (Passed)' : i['desc'] + ' (Failed)',
        description: 'yea: ' + i['yea'] + ' nay: ' + i['nay'] + ' nv: ' + i['nv'],
        chamber: i['chamber'], //todo: lookup chamber
        data: i
      })
    );
  }
  const orderedTimeline = timeline
    .sort((a, b) => {
      return cmp(new Date(a.date), new Date(b.date)) || cmp(a.id, b.id);
    })
    .map((i, index) => {
      return {
        eventIndex: index,
        id: `${billNew.bill_id}_${i.id}`,
        bill_id: billNew.bill_id.toString(),
        datetime: new Date(`${i.date}T00:00:00-06:00`),
        date: i.date,
        time: '',
        eventType: i.eventType,
        title: i.title,
        description: i.description,
        chamber: i.chamber,
        data: i.data,
        parent_id: ''
      };
    });
  return {
    timeline: orderedTimeline,
    last_action_date: last_action_date,
    last_action: last_action
  };
}

const getBill = async (req, res, next) => {
  const id = req.params.id || 1;
  var url = legiscanUrl + '&op=getBill&id=' + id;
  req.data = await fetch(url).then(res => res.json());
  next();
};

const search = async (req, res, next) => {
  const filterValues = JSON.parse(req.query.filter);
  if (filterValues.q !== 'undefined') {
    const legiscanParams = {
      state: filterValues.state || 'OK',
      query: filterValues.q || {},
      year: filterValues.year || 1,
      page: req.query['page'] || 1
    };
    //map params from object to string
    const p = Object.entries(legiscanParams)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');

    //build url
    const url = `${legiscanUrl}&op=search&${p}`;
    req.data = await fetch(url).then(res => res.json());
  } else req.data = null;
  next();
};

const savePerson = async personId => {
  const url = `${legiscanUrl}&op=getPerson&id=${personId.toString()}`;
  const personJson = await fetch(url).then(res => res.json());
  const person = personJson.person;
  const personRef = await firestore.collection('people').doc(personId.toString());
  await personRef.get().then(docSnapshot => {
    if (!docSnapshot.exists) {
      personRef.set(person);
    }
  });
  return person;
};

const getVote = async vote => {
  const person = await firestore
    .collection('people')
    .doc(vote.people_id.toString())
    .get()
    .then(doc => {
      if (!(doc && doc.exists)) {
        console.log(`Person missing: ${vote.people_id}`);
        const newPerson = savePerson(vote.people_id);
        return newPerson;
      }
      return doc.data();
    });

  return {
    people_id: vote.people_id,
    vote_id: vote.vote_id,
    vote_text: vote.vote_text,
    rep_name: person.name,
    rep_party_id: person.party_id,
    rep_district: person.district,
    rep_role_type: person.role_id
  };
};

const saveRollCallReq = async (req, res, next) => {
  const rollCallId = req.params.id;
  const response = await saveRollCall(rollCallId, true);
  res.send(response);
  next();
};

const saveRollCall = async (rollCallId, forceUpdate) => {
  const url = `${legiscanUrl}&op=getRollcall&id=${rollCallId.toString()}`;
  const rollcallJson = await fetch(url).then(res => res.json());
  const rollcall = rollcallJson.roll_call;
  const bodyId = rollcall.chamber_id;
  const bodyRef = await firestore.collection('bodies').doc(bodyId.toString());
  const body = await bodyRef.get().then(docSnapshot => docSnapshot.data());

  const rollCallRef = await firestore.collection('roll_calls').doc(rollCallId.toString());

  var votes = [];
  for (var i = 0; i < rollcall.votes.length; i++) {
    const newVote = await getVote(rollcall.votes[i]);
    votes.push(newVote);
  }

  await rollCallRef.get().then(docSnapshot => {
    if (!docSnapshot.exists) {
      const newRollCall = {
        absent: rollcall.absent,
        bill_id: rollcall.bill_id,
        chamber: rollcall.chamber,
        chamber_id: rollcall.chamber_id,
        date: rollcall.date,
        desc: rollcall.desc,
        nay: rollcall.nay,
        nv: rollcall.nv,
        passed: rollcall.passed,
        roll_call_id: rollcall.roll_call_id,
        total: rollcall.total,
        yea: rollcall.yea,
        votes: votes
      };
      rollCallRef.set(newRollCall);

      return { response: 'New rollcall saved successfully' };
    }
    if (forceUpdate) {
      rollCallRef.update({ votes: votes });

      return { response: 'Existing rollcall updated successfully' };
    }

    return { response: 'Rollcall already up to date' };
  });
};

const save = async (req, res, next) => {
  const id = req.params.id.toString();
  const currentTime = new Date();
  const url = legiscanUrl + '&op=getBill&id=' + id;
  const legiscanBill = await fetch(url).then(res => res.json());

  const bill = legiscanBill.bill;
  const savedBill = await firestore
    .collection('bills')
    .doc(id)
    .get()
    .then(doc => {
      if (!(doc && doc.exists)) {
        return null;
      }
      return doc.data();
    });

  const votes = bill.votes;
  for (var v = 0; v < votes.length; v++) {
    const rollCallId = votes[v].roll_call_id;
    const saveResponse = await saveRollCall(rollCallId, false);
    console.log(saveResponse);
  }
  if (!savedBill) {
    const { timeline, last_action_date, last_action } = getFeedEvents(bill, null);
    const feed_dates = timeline.map(d => d.date).filter((value, index, self) => self.indexOf(value) === index);

    firestore
      .collection('bills')
      .doc(id)
      .set({
        ...bill,
        ...{
          createdOn: currentTime,
          updatedOn: currentTime,
          ...{
            last_action_date: last_action_date
          },
          ...{
            last_action: last_action
          },
          ...{
            projects: []
          },
          ...{
            feed_dates: feed_dates
          }
        }
      })
      .then(() => {
        timeline.map(t => {
          firestore.collection('bill_feed').doc(t.id).set(t);
        });
      })
      .then(() => res.send({ response: 'new bill saved successfully' }))
      .catch(err => {
        //console.error(err);
        res.status(404).send({ error: 'unable to store', err });
      });
  } else if (bill.change_hash !== savedBill.change_hash) {
    const { timeline, last_action_date, last_action } = getFeedEvents(bill, savedBill);
    const new_feed_dates = timeline
      .map(d => d.date)
      .filter((value, index, self) => self.indexOf(value) === index)
      .filter(value => !savedBill.feed_dates.includes(value));

    const feed_dates = savedBill.feed_dates.concat(new_feed_dates);

    firestore
      .collection('bills')
      .doc(id)
      .set({
        ...bill,
        ...{ updatedOn: currentTime },
        ...{
          last_action_date: last_action_date
        },
        ...{
          last_action: last_action
        },
        ...{
          feed_dates: feed_dates
        }
      })
      .then(() => {
        timeline.map(t => {
          firestore.collection('bill_feed').doc(t.id).set(t);
        });
      })
      .then(() => {
        res.send({ response: 'bill updated successfully' });
      })
      .catch(err => {
        res.status(404).send({ error: 'unable to save', err });
      });
  }
  next();
};

app.use(function (req, res, next) {
  res.header('Content-Type', 'application/json');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Expose-Headers', 'X-Total-Count');
  next();
});

app.use(
  bodyParser.urlencoded({
    extended: true
  })
);

app.use(bodyParser.json());

app.post('/ls/save/:id', save, ({ data }, res) => {
  res.send({ data });
});

app.post('/ls/saveRollCall/:id', saveRollCallReq, ({ data }, res) => {
  res.send({ data });
});

app.get('/ls/bill/:id*', getBill, ({ data }, res) => {
  var bill = { ...data.bill };
  bill['id'] = bill['bill_id'];
  res.send(bill);
});

app.get('/ls/search', search, ({ data }, res) => {
  const summary = { ...data.searchresult.summary };
  res.set('x-total-count', summary.count);
  res.send(
    Object.entries({ ...data.searchresult })
      .filter(f => f[0] != 'summary')
      .map(e => {
        const elm = e[1];
        return {
          id: elm['bill_id'],
          relevance: elm['relevance'],
          state_abbr: elm['state'],
          bill_number: elm['bill_number'],
          title: elm['title'],
          change_hash: elm['change_hash'],
          url: elm['url'],
          text_url: elm['text_url'],
          last_action_date: elm['last_action_date'],
          last_action: elm['last_action']
        };
      })
  );
});

app.listen(process.env.PORT || 2017, () => console.log(`\nServing application on port ${process.env.PORT || 2017}\n`));

module.exports = {
  legiscanApi: app
};
