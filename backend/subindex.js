"use strict";
const EventParser = require('./modules/eventParser.js');
const LiveParser = require('./modules/liveParser.js');
const express = require('express');
const helmet = require('helmet');
const app = express();
const fs = require('fs');
const Redis = require('ioredis');
const ContractLoader = require('./modules/contractLoader.js');
var bodyParser = require('body-parser')
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(helmet());
var cors = require('cors')
app.use(cors())
let contracts;
let tokens = [];
var Web3 = require('web3');
var web3 = new Web3();
web3.setProvider(new web3.providers.HttpProvider('http://0.0.0.0:8545'));

const DESKTOPMINERACCOUNT = 3 //index in geth

let accounts
web3.eth.getAccounts().then((_accounts)=>{
  accounts=_accounts
  console.log("ACCOUNTS",accounts)
})

const NETWORK = parseInt(fs.readFileSync("../deploy.network").toString().trim())
if(!NETWORK){
  console.log("No deploy.network found exiting...")
  process.exit()
}
console.log("NETWORK:",NETWORK)

let subscriptionListKey = "subscriptionList"+NETWORK


let redisHost = 'localhost'
let redisPort = 57300
if(NETWORK>0&&NETWORK<9){
 redisHost = 'cryptogsnew.048tmy.0001.use2.cache.amazonaws.com'
 redisPort = 6379
}
let redis = new Redis({
  port: redisPort,
  host: redisHost,
})

console.log("LOADING CONTRACTS")
contracts = ContractLoader(["Subscription"],web3);

//my local geth node takes a while to spin up so I don't want to start parsing until I'm getting real data
function checkForGeth() {
  contracts["Subscription"].methods.owner().call({}, function(error, result){
      console.log("COUNT",error,result)
      if(error){
        setTimeout(checkForGeth,15000);
      }else{
        startParsers()
      }
  });
}
checkForGeth()

function startParsers(){
  web3.eth.getBlockNumber().then((blockNumber)=>{
    //parsers here
    //
    //
    setInterval(()=>{
      console.log("::: SUBSCRIPTION CHECKER :::: loading subscriptions from cache...")
      redis.get(subscriptionListKey, async (err, result) => {
        let subscriptions
        try{
          subscriptions = JSON.parse(result)
        }catch(e){contracts = []}
        if(!subscriptions) subscriptions = []
        console.log("current subscriptions:",subscriptions.length)
        for(let t in subscriptions){
          console.log("Check Sub Signature:",subscriptions[t].signature)
          let contract = new web3.eth.Contract(contracts.Subscription._jsonInterface,subscriptions[t].subscriptionContract)
          let doubleCheckHash = await contract.methods.getSubscriptionHash(subscriptions[t].parts[0],subscriptions[t].parts[1],subscriptions[t].parts[2],subscriptions[t].parts[3],subscriptions[t].parts[4],subscriptions[t].parts[5],subscriptions[t].parts[6],subscriptions[t].parts[7]).call()
          //console.log(subscriptions[t].parts[0],subscriptions[t].parts[1],subscriptions[t].parts[2],subscriptions[t].parts[3],subscriptions[t].parts[4],subscriptions[t].parts[5],subscriptions[t].parts[6],subscriptions[t].parts[7],subscriptions[t].signature)
          let ready = await contract.methods.isSubscriptionReady(subscriptions[t].parts[0],subscriptions[t].parts[1],subscriptions[t].parts[2],subscriptions[t].parts[3],subscriptions[t].parts[4],subscriptions[t].parts[5],subscriptions[t].parts[6],subscriptions[t].parts[7],subscriptions[t].signature).call()
          if(ready){
            console.log("subscription says it's ready... try a dry run ---> ")
            let dryRun = false
            try{
              dryRun = await contract.methods.executeSubscription(subscriptions[t].parts[0],subscriptions[t].parts[1],subscriptions[t].parts[2],subscriptions[t].parts[3],subscriptions[t].parts[4],subscriptions[t].parts[5],subscriptions[t].parts[6],subscriptions[t].parts[7],subscriptions[t].signature).call()
            }catch(e){
              console.log(e.toString())
            }
            if(dryRun){
              doSubscription(contract,subscriptions[t])
            }else{
              console.log("Even though it says it's ready, the dry run failed. Probably a gas issue... as in the contract is out of Eth or unable to pay the gasPayer can't pay the gasToken")
            }
          }else{
            //removesubscription(subscriptions[t].sig)
            console.log("--- not ready -- since they never get removed you may want to figure out a way to trash expired or paused and then add them back when they go active again---")
          }
        }
      });
    },5000)

  })
}

function removeSubscription(sig){
  redis.get(subscriptionListKey, function (err, result) {
    let subscriptions
    try{
      subscriptions = JSON.parse(result)
    }catch(e){subscriptions = []}
    if(!subscriptions) subscriptions = []
    let newSubscriptions = []
    for(let t in subscriptions){
      if(subscriptions[t].sig!=sig){
        newSubscriptions.push(subscriptions[t])
      }
    }
    redis.set(subscriptionListKey,JSON.stringify(newSubscriptions),'EX', 60 * 60 * 24 * 7);
  });
}

app.get('/clear', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/clear")
  res.set('Content-Type', 'application/json');
  res.end(JSON.stringify({hello:"world"}));
  redis.set(subscriptionListKey,JSON.stringify([]),'EX', 60 * 60 * 24 * 7);
});

app.get('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/")
  res.set('Content-Type', 'application/json');
  res.end(JSON.stringify({hello:"world"}));

});

app.get('/miner', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/miner")
  res.set('Content-Type', 'application/json');
  res.end(JSON.stringify({address:accounts[DESKTOPMINERACCOUNT]}));

});

app.get('/sigs/:contract', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/sigs/"+req.params.contract)
  let sigsKey = req.params.contract+"sigs"
  redis.get(sigsKey, function (err, result) {
    res.set('Content-Type', 'application/json');
    res.end(result);
  })

});

app.get('/contracts', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/contracts")
  let deployedContractsKey = "deployedcontracts"+NETWORK
  redis.get(deployedContractsKey, function (err, result) {
    res.set('Content-Type', 'application/json');
    res.end(result);
  })

});

app.get('/subcontracts', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/subcontracts")
  let deployedSubContractsKey = "deployedsubcontracts"+NETWORK
  redis.get(deployedSubContractsKey, function (err, result) {
    res.set('Content-Type', 'application/json');
    res.end(result);
  })

});

app.get('/subscriptions', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/subscriptions")
  redis.get(subscriptionListKey, function (err, result) {
    res.set('Content-Type', 'application/json');
    res.end(result);
  })
});

app.post('/sign', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/sign",req.body)
  let account = web3.eth.accounts.recover(req.body.message,req.body.sig)
  console.log("RECOVERED:",account)
  if(account.toLowerCase()==req.body.account.toLowerCase()){
    console.log("Correct sig... log them into the contract...")
    let sigsKey = req.body.address+"sigs"
    redis.get(sigsKey, function (err, result) {
      let sigs
      try{
        sigs = JSON.parse(result)
      }catch(e){sigs = []}
      if(!sigs) sigs = []
      console.log("current sigs:",sigs)
      if(sigs.indexOf(req.body.account.toLowerCase())<0){
        sigs.push(req.body.account.toLowerCase())
        console.log("saving sigs:",sigs)
        redis.set(sigsKey,JSON.stringify(sigs),'EX', 60 * 60 * 24 * 7);
      }
    });
  }
  res.set('Content-Type', 'application/json');
  res.end(JSON.stringify({hello:"world"}));
});

app.post('/deploy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/deploy",req.body)
  let contractAddress = req.body.contractAddress
  let deployedContractsKey = "deployedcontracts"+NETWORK
  redis.get(deployedContractsKey, function (err, result) {
    let contracts
    try{
      contracts = JSON.parse(result)
    }catch(e){contracts = []}
    if(!contracts) contracts = []
    console.log("current contracts:",contracts)
    if(contracts.indexOf(contractAddress)<0){
      contracts.push(contractAddress)
    }
    console.log("saving contracts:",contracts)
    redis.set(deployedContractsKey,JSON.stringify(contracts),'EX', 60 * 60 * 24 * 7);
    res.set('Content-Type', 'application/json');
    res.end(JSON.stringify({contract:contractAddress}));
  });
})

app.post('/deploysub', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/deploy",req.body)
  let contractAddress = req.body.contractAddress
  let deployedSubContractsKey = "deployedsubcontracts"+NETWORK
  redis.get(deployedSubContractsKey, function (err, result) {
    let contracts
    try{
      contracts = JSON.parse(result)
    }catch(e){contracts = []}
    if(!contracts) contracts = []
    console.log("current contracts:",contracts)
    if(contracts.indexOf(contractAddress)<0){
      contracts.push(contractAddress)
    }
    console.log("saving contracts:",contracts)
    redis.set(deployedSubContractsKey,JSON.stringify(contracts),'EX', 60 * 60 * 24 * 7);
    res.set('Content-Type', 'application/json');
    res.end(JSON.stringify({contract:contractAddress}));
  });
})

app.post('/saveSubscription', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log("/saveSubscription",req.body)
  let account = web3.eth.accounts.recover(req.body.subscriptionHash,req.body.signature)
  console.log("RECOVERED:",account)
  if(account.toLowerCase()==req.body.parts[0].toLowerCase()){
    console.log("Correct sig... relay subscription to contract... might want more filtering here, but just blindly do it for now")
    redis.get(subscriptionListKey, function (err, result) {
      let subscriptions
      try{
        subscriptions = JSON.parse(result)
      }catch(e){contracts = []}
      if(!subscriptions) subscriptions = []
      console.log("current subscriptions:",subscriptions)
      subscriptions.push(req.body)
      console.log("saving subscriptions:",subscriptions)
      redis.set(subscriptionListKey,JSON.stringify(subscriptions),'EX', 60 * 60 * 24 * 7);
    });
  }
  res.set('Content-Type', 'application/json');
  res.end(JSON.stringify({hello:"world"}));
});

app.listen(10002);
console.log(`http listening on 10002`);


function doSubscription(contract,subscriptionObject){
  //console.log(contracts.BouncerProxy)

  console.log("Running subscription on contract ",contract._address," with local account ",accounts[3])
  let txparams = {
    from: accounts[DESKTOPMINERACCOUNT],
    gas: 1000000,
    gasPrice:Math.round(4 * 1000000000)
  }

  //const result = await clevis("contract","forward","BouncerProxy",accountIndexSender,sig,accounts[accountIndexSigner],localContractAddress("Example"),"0",data,rewardAddress,reqardAmount)
  console.log("subscriptionObject",subscriptionObject.parts[0],subscriptionObject.parts[1],subscriptionObject.parts[2],subscriptionObject.parts[3],subscriptionObject.parts[4],subscriptionObject.parts[5],subscriptionObject.parts[6],subscriptionObject.parts[7],subscriptionObject.signature)
  console.log("PARAMS",txparams)
  contract.methods.executeSubscription(subscriptionObject.parts[0],subscriptionObject.parts[1],subscriptionObject.parts[2],subscriptionObject.parts[3],subscriptionObject.parts[4],subscriptionObject.parts[5],subscriptionObject.parts[6],subscriptionObject.parts[7],subscriptionObject.signature).send(
  txparams ,(error, Hash)=>{
    console.log("TX CALLBACK",error,Hash)
  })
  .on('error',(err,receiptMaybe)=>{
    console.log("TX ERROR",err,receiptMaybe)
  })
  .on('subscriptionHash',(subscriptionHash)=>{
    console.log("TX HASH",subscriptionHash)
  })
  .on('receipt',(receipt)=>{
    console.log("TX RECEIPT",receipt)
  })
  /*.on('confirmation', (confirmations,receipt)=>{
    console.log("TX CONFIRM",confirmations,receipt)
  })*/
  .then((receipt)=>{
    console.log("TX THEN",receipt)
  })
}
