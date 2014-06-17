'use strict';

var Ractive = require('hive-ractive')
var Big = require('big.js')
var emitter = require('hive-emitter')
var db = require('hive-db')
var getWallet = require('hive-wallet').getWallet
var currencies = require('hive-ticker-api').currencies
var btcToSatoshi = require('hive-convert').btcToSatoshi
var satoshiToBtc = require('hive-convert').satoshiToBtc
var toDecimal = require('hive-convert').toDecimal
var showError = require('hive-flash-modal').showError
var showConfirmation = require('hive-confirm-overlay')
var Address = require('bitcoinjs-lib').Address

module.exports = function(el){
  var ractive = new Ractive({
    el: el,
    template: require('./index.ract').template,
    data: {
      currencies: currencies,
      exchangeRates: {}
    }
  })

  emitter.on('clear-send-form', function(){
    ractive.set('to', '')
    ractive.set('value', '')
    ractive.set('fiatValue', '')
  })

  emitter.on('prefill-wallet', function(address) {
    ractive.set('to', address)
  })

  ractive.on('open-geo', function(){
    var data = {
      overlay: 'geo',
      context: 'send'
    }
    emitter.emit('open-overlay', data)
  })

  ractive.on('open-send', function(){
    validateSend(function(err, tx){
      if(err) return showError({title: 'Uh oh!', message: err.message});

      showConfirmation({
        to: ractive.get('to'),
        amount: ractive.get('value'),
        denomination: ractive.get('denomination'),
        fee: satoshiToBtc(tx.estimateFee())
      })
    })
  })


  emitter.on('wallet-ready', function(){
    ractive.set('denomination', getWallet().denomination)
  })

  emitter.on('db-ready', function(){
    db.get(function(err, doc){
      if(err) return console.error(err);

      ractive.set('selectedFiat', doc.systemInfo.preferredCurrency)
    })
  })

  emitter.on('ticker', function(rates){
    ractive.set('exchangeRates', rates)
  })

  ractive.observe('selectedFiat', setPreferredCurrency)

  ractive.on('fiat-to-bitcoin', function(){
    var fiat = ractive.nodes.fiat.value
    if(fiat == undefined || fiat === '') return;

    var exchangeRate = ractive.get('exchangeRates')[ractive.get('selectedFiat')]
    var bitcoin = new Big(fiat).div(exchangeRate).toFixed(8)

    ractive.set('value', bitcoin)
  })

  ractive.on('bitcoin-to-fiat', function(){
    var bitcoin = ractive.nodes.bitcoin.value
    if(bitcoin == undefined || bitcoin === '') return;


    var exchangeRate = ractive.get('exchangeRates')[ractive.get('selectedFiat')]
    var val = new Big(bitcoin).times(exchangeRate)
    var fiat = toDecimal(val, 100).toFixed(2)

    ractive.set('fiatValue', fiat)
  })

  function validateSend(callback) {
    var amount = ractive.get('value')
    var address = ractive.get('to')
    var wallet = getWallet()
    var tx = null

    try{
      Address.fromBase58Check(address)
    } catch(e) {
      return callback(new Error('Please enter a valid address to send to.'))
    }

    try {
      tx = wallet.createTx(address, btcToSatoshi(amount))
    } catch(e) {
      var message = e.message
      var userMessage = message

      if(message.match(/dust threshold/)) {
        userMessage = 'Please an amount above ' + satoshiToBtc(wallet.dustThreshold)
      } else if(message.match(/Not enough funds/)) {
        userMessage = "You don't have enough funds in your wallet."
      } else {
        return callback(e)
      }
      return callback(new Error(userMessage))
    }

    callback(null, tx)
  }

  function onTxSent(err, tx){
    if(err) {
      return showError({ message: "error sending transaction. " + err })
    }

    // update balance & tx history
    emitter.emit('wallet-ready')
    emitter.emit('transactions-loaded', [tx])
  }

  function setPreferredCurrency(currency, old){
    if(old == undefined) return; //when loading wallet

    db.set('systemInfo', {preferredCurrency: currency}, function(err, response){
      if(err) return console.error(response);

      emitter.emit('preferred-currency-changed', currency)
      ractive.fire('bitcoin-to-fiat')
    })
  }

  return ractive
}
