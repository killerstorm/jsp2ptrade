
     function log_event(ekind, msg) {
         console.log("Event: " + ekind + " Msg:" + msg);
     }

     function MockExchangeTransaction (wallet, data) {
         this.wallet = wallet;
         this.tx = data.tx;
         this.my = data.my;
     }
     MockExchangeTransaction.prototype.checkOutputsToMe = function (myaddress, color, value) {
         var total = 0;
         this.tx.out.forEach(function (out) {
                                 if (out.to == myaddress && out.color == color)
                                     total += out.value;
                                 });
         return (total >= value);
     };
     MockExchangeTransaction.prototype.signMyInputs = function (reftx) {
         var my = reftx ? reftx.my : this.my;
         this.tx.inp.forEach(function (inp) {
                                if (my.indexOf(inp.outpoint) >= 0)
                                    inp.signed = true;
                                 });
         return true;
     };
     MockExchangeTransaction.prototype.broadcast = function () {
         log_event("MockExchangeTransaction.broadcast");
         if (!this.hasEnoughSignatures())
             throw "trying to broadcast tx without enough signatures";
         return true;
     };
     MockExchangeTransaction.prototype.hasEnoughSignatures = function (){
         for (var i in this.tx.inp) {
             if (!this.tx.inp[i].signed)
                 return false;
         }
         return true;
     };
     MockExchangeTransaction.prototype.appendTx = function (etx) {
         // TODO: handle colors?
         this.tx.inp = this.tx.inp.concat(etx.tx.inp);
         this.tx.out = this.tx.out.concat(etx.tx.out);
         this.my = this.my.concat(etx.my);
     };
     MockExchangeTransaction.prototype.getData = function () {
         return this.tx;
     };
     

     function MockWallet () {
         this.id = make_random_id();
     }
     MockWallet.prototype.getAddress = function (colorid, is_change) {
             return "a_" + this.id + "_" + make_random_id();
     };
     MockWallet.prototype.createPayment = function (color, amount, to_address) {
         var outpoint= "o_" + this.id + "_" + make_random_id();
         return new MockExchangeTransaction(this, 
                                            {
                                                tx: {inp: [{outpoint: outpoint, signed: false}],
                                                     out: [{to: to_address, value: amount, color: color}]},
                                                my: [outpoint]
                                            });
     };
     MockWallet.prototype.importTx = function (tx_data) {
         return new MockExchangeTransaction(this, 
                                            {
                                                tx: tx_data,
                                                my: []
                                            });
     };

     function now () {
         return Math.round((new Date()).getTime()/1000);
     }

     var STANDARD_OFFER_EXPIRY_INTERVAL = 60;
     var STANDARD_OFFER_VALIDITY_INTERVAL = 15;

     function make_random_id() {
         var text = "";
         var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

         for( var i=0; i < 10; i++ )
             text += possible.charAt(Math.floor(Math.random() * possible.length));
         return text;
     }

     function ExchangeOffer(oid, A, B) {
         // A = offerer's side, B = replyer's side
         // ie. offerer says "I want to give you A['value'] coins of color 
         // A['colorid'] and receive B['value'] coins of color B['colorid']"

         if (oid == null) {
             if (!A) 
                 return; //empty object
             oid = make_random_id();
         } else if (typeof oid == 'object') {
             A = $.extend(true, {}, oid.A);
             B = $.extend(true, {}, oid.B);
             oid = oid.oid;
         }
         this.oid = oid;
         this.A = A;
         this.B = B;
         this.expires = null;
     }
     ExchangeOffer.prototype.getData = function () {
         return {
             oid: this.oid,
             A: this.A,
             B: this.B
         };
     };
     ExchangeOffer.prototype.expired = function (shift) {
         return !this.expires 
             || (this.expires < now() + (shift || 0));
     };
     ExchangeOffer.prototype.refresh = function (delta) {
         this.expires = now() + (delta || STANDARD_OFFER_EXPIRY_INTERVAL);
     };
     ExchangeOffer.prototype.matches = function (offer) {
         // cross match A -> B, B -> A.
         var self = this;
         function prop_matches(name) {
             return (self.A[name] == offer.B[name]) && (self.B[name] == offer.A[name]);
         }
         return prop_matches('value') && prop_matches('colorid');
     };
     ExchangeOffer.prototype.isSameAsMine = function (my_offer) {
         if (my_offer.A.address && my_offer.A.address != this.A.address)
             return false;
         if (my_offer.B.address && my_offer.B.address != this.B.address)
             return false;
         var self = this;
         function checkprop (name) {
             if (self.A[name] != my_offer.A[name]) return false;
             if (self.B[name] != my_offer.B[name]) return false;
             return true;
         }
         if (!checkprop('colorid')) return false;
         if (!checkprop('value')) return false;
         return true;
     };
     
     function MyExchangeOffer (oid, A, B, auto_post){
         ExchangeOffer.apply(this, arguments);
         this.auto_post = (auto_post === false) ? false : true;
     };
     MyExchangeOffer.prototype = new ExchangeOffer();

    
     function ExchangeProposal (wallet) {
         this.wallet = wallet;
     }
     ExchangeProposal.prototype.createNew = function (offer, etx, my_offer) {
         this.pid = make_random_id();
         this.offer = offer;
         this.etx = etx;
         this.my_offer = my_offer;
         this.state = 'proposed';
     };
     ExchangeProposal.prototype.getData = function () {
         return {
             pid: this.pid,
             offer: this.offer.getData(),
             tx: this.etx.getData()
         };
     };
     ExchangeProposal.prototype.importTheirs = function (data) {
         this.pid = data.pid;
         this.offer = new ExchangeOffer(data.offer);
         this.etx = this.wallet.importTx(data.tx);
         this.my_offer = null;
         this.state = 'imported';
     };
     ExchangeProposal.prototype.addMyTranche = function (p) {
         this.etx.appendTx(p);
     };
     ExchangeProposal.prototype.checkOutputsToMe = function (myaddress, color, value) {
         /*  Does their tranche have enough of the color
          that I want going to my address? */
         return this.etx.checkOutputsToMe(myaddress, color, value);
     };
     ExchangeProposal.prototype.signMyInputs = function (reftx) {
         return this.etx.signMyInputs(reftx);
     };
     

     function  resolveColor(colorid) {
         //TODO: barf if colorid is not recognized
         return colorid;
     }
     
     function ExchangePeerAgent(wallet, comm) {
         this.my_offers = {};
         this.their_offers = {};
         this.wallet = wallet;
         this.active_ep = null;
         this.ep_timeout = null;
         this.comm = comm;
         this.match_offers = false;
         this.onCompleteTrade = function () {};
     };
     ExchangePeerAgent.prototype.setActiveEP = function (ep) {
         this.active_ep = ep;
         if (ep == null) {
             this.ep_timeout = null;
             this.match_orders = true;
         } else {
             this.ep_timeout = now() + STANDARD_OFFER_EXPIRY_INTERVAL;
         }
         
     };
     ExchangePeerAgent.prototype.hasActiveEP = function () {
         if (this.ep_timeout && this.ep_timeout < now()) {
             this.setActiveEP(null); //TODO: cleanup?
             return false;
         } else 
             return this.active_ep != null;
     };
     ExchangePeerAgent.prototype.serviceMyOffers = function () {
         for (var oid in this.my_offers) {
             var offer = this.my_offers[oid];
             if (offer.auto_post) {
                 if (!offer.expired(+STANDARD_OFFER_VALIDITY_INTERVAL)) continue;
                 if (this.active_ep) {
                     if (this.active_ep.offer.oid == offer.oid) continue;
                     if (this.active_ep.my_offer &&
                         this.active_ep.my_offer.oid == offer.oid) continue;
                 }
                 offer.refresh();
                 this.postMessage(offer);
             }       
         }
     };
     ExchangePeerAgent.prototype.serviceTheirOffers = function () {
         for (var oid in this.their_offers) {
             var offer = this.their_offers[oid];
             if (offer.expired(-STANDARD_OFFER_VALIDITY_INTERVAL))
                 delete this.their_offers[oid];
         }       
     };
     ExchangePeerAgent.prototype.updateState = function () {
         if (this.match_offers) {
             this.match_offers = false;
             this.matchOffers();
         }
         this.serviceMyOffers();
         this.serviceTheirOffers();
     };
     ExchangePeerAgent.prototype.registerMyOffer = function (offer) {
         if (!offer.A.address)
             offer.A.address = this.wallet.getAddress(resolveColor(offer.A.colorid), false);
         this.my_offers[offer.oid] = offer;
         this.match_offers = true;
     };
     ExchangePeerAgent.prototype.registerTheirOffer = function (offer) {
         this.their_offers[offer.oid] = offer;
         offer.refresh();
         this.match_offers = true;
     };
     ExchangePeerAgent.prototype.cancelMyOffer = function (offer) {
         if (this.active_ep && ((this.active_ep.offer.oid == offer.oid)
                                || (this.active_ep.my_offer.oid == offer.oid)))
             this.setActiveEP(null);
         else
             if (this.my_offers[offer.oid])
                 delete this.my_offer[offer.oid];

     };
     ExchangePeerAgent.prototype.matchOffers = function () {
         log_event("ExchangePeerAgent.matchOffers");     
         if (this.hasActiveEP())
             return;
         for (var my_oid in this.my_offers) {
             var my_offer = this.my_offers[my_oid];
             for (var their_oid in this.their_offers) {
                 var their_offer = this.their_offers[their_oid];
                 if (my_offer.matches(their_offer)) {
                     var success = false;
                     try {
                         this.makeExchangeProposal(their_offer, my_offer.A.address, my_offer.A.value, my_offer);
                         success = true;
                     } catch (x) {
                         log_event("error", "error in makeExchangeProposal called from matchOffers");
                     }
                     if (success) return;
                 }
             }
         }
     };
     ExchangePeerAgent.prototype.makeExchangeProposal = function (orig_offer, my_address, my_value, related_offer) {
         log_event("ExchangePeerAgent.makeExchangeProposal");
         if (this.hasActiveEP()) 
             throw "already have active EP (in makeExchangeProposal)";
         var offer = new ExchangeOffer(orig_offer);
         if (my_value != offer.B.value)
             throw "partial fill isn't yet implemented";
         if (!my_address) {
             if (related_offer && related_offer.A.address)
                 my_address = related_offer.A.address;
             else
                 my_address = this.wallet.getSomeAddress();
         }
         offer.B.address = my_address;
         var acolor = resolveColor(offer.A.colorid);
         var bcolor = resolveColor(offer.B.colorid);
         var ep = new ExchangeProposal(this.wallet);
         ep.createNew(offer, 
                      this.wallet.createPayment(bcolor, my_value, offer.A.address),
                      related_offer);
         this.setActiveEP(ep);
         this.postMessage(ep);
     };
     ExchangePeerAgent.prototype.dispatchExchangeProposal = function (ep_data) {
         log_event("ExchangePeerAgent.dispatchExchangeProposal");
         var ep = new ExchangeProposal(this.wallet);
         ep.importTheirs(ep_data);
         if (this.hasActiveEP()) {
             if (ep.pid == this.active_ep.pid)
                 return this.updateExchangeProposal(ep);
         } else {
             if (this.my_offers[ep.offer.oid])
                 return this.acceptExchangeProposal(ep);
         }
        // We have neither an offer nor a proposal matching this ExchangeProposal
        if (this.their_offers[ep.offer.oid]) {
            // remove offer if it is in-work
            // TODO: set flag instead of deleting it
            delete this.their_offers[ep.offer.oid];
        }
        return null;
     };
     ExchangePeerAgent.prototype.acceptExchangeProposal = function (ep) {
         log_event("ExchangePeerAgent.acceptExchangeProposal", ep.pid);
         if (this.hasActiveEP()) return;
         var offer = ep.offer;
         var my_offer = this.my_offers[offer.oid];
         if (!offer.isSameAsMine(my_offer))
             throw "is invalid or incongruent with my offer (acceptExchangeProposal)";
         var acolor = resolveColor(offer.A.colorid);
         var bcolor = resolveColor(offer.B.colorid);
         if (!ep.checkOutputsToMe(offer.A.address, bcolor, offer.B.value))
             throw "Proposed tx does not pay enough coins of the color I want to me";
         var p = this.wallet.createPayment(acolor, offer.A.value, offer.B.address);
         ep.addMyTranche(p);
         ep.signMyInputs(p);
         this.setActiveEP(ep);
         ep.state = 'accepted';
         this.postMessage(ep);
     };
     ExchangePeerAgent.prototype.clearOrders = function (ep) {
         if (ep.state == 'proposed') {
             if (ep.my_offer) delete this.my_offers[ep.my_offer.oid];
             delete this.their_offers[ep.offer.oid];
         } else {
             delete this.my_offers[ep.offer.oid];
         }
     };
     ExchangePeerAgent.prototype.updateExchangeProposal = function (ep) {
         var my_ep = this.active_ep;
         if (!my_ep || my_ep.pid != ep.pid)
             throw "updateExchangeProposal: wrong state";
         var offer = my_ep.offer;
         var acolor = resolveColor(offer.A.colorid);
         var bcolor = resolveColor(offer.B.colorid);
         if (my_ep.state == 'proposed') {
             if (! ep.checkOutputsToMe(offer.B.address, acolor, offer.A.value))
                 throw "Proposed tx does not pay enough coins of the color I want to me";
             ep.signMyInputs(my_ep.etx);
         } else if (my_ep.state == 'accepted') {
             if (! ep.checkOutputsToMe(offer.A.address, bcolor, offer.B.value))
                 throw "Proposed tx does not pay enough coins of the color I want to me";
             // TODO: should we sign it again?
         } else throw "EP state is wrong in updateExchangeProposal";
         
         if (!ep.etx.hasEnoughSignatures())
             throw "Not all inputs are signed";
         ep.etx.broadcast();
         this.clearOrders(my_ep);
         //TODO: on complete
         this.setActiveEP(null);
         if (my_ep.state == 'proposed') 
             this.postMessage(ep);
     };
     ExchangePeerAgent.prototype.postMessage = function (obj) {
         log_event("ExchangePeerAgent.postMessage", JSON.stringify(obj.getData()));
         this.comm.postMessage(obj.getData());
     };
     ExchangePeerAgent.prototype.dispatchMessage = function (data) {
         log_event("ExchangePeerAgent.dispatchMessage", JSON.stringify(data));
         try {
             if (data.oid) {
                 var o = new ExchangeOffer(data);
                 this.registerTheirOffer(o);
             } else if (data.pid) {
                 this.dispatchExchangeProposal(data);
             }
         } catch (x) {
             log_event('error', "error in dispatchExchangeProposal: " + x.toString());
         }
     };


     function HTTPExchangeComm (url) {
         this.agents = [];
         this.lastpoll = -1;
         this.url = url || 'http://localhost:8090/messages';
         this.own_msgids = {};
     }
     HTTPExchangeComm.prototype.addAgent = function (agent) {
         this.agents.push(agent);
     };
     HTTPExchangeComm.prototype.postMessage = function (content) {
         var msgid = make_random_id();
         content.msgid = msgid;
         this.own_msgids[msgid] = 1;
         var str = JSON.stringify(content);
         $.ajax({
                    data: str,
                    url: this.url,
                    type: 'POST'
                    //TODO: handle error
                });
     };
     HTTPExchangeComm.prototype.pollAndDispatch = function (cont) {
         var data;
         var self = this;
         if (this.lastpoll == -1)
             data = {from_timestamp: (now() - STANDARD_OFFER_EXPIRY_INTERVAL).toString()};
         else
             data = {from_serial: (this.lastpoll + 1).toString()};
         $.ajax({
                    url: this.url,
                    data: data,
                    dataType: 'json',
                    success: function (resp) {
                        log_event("HTTPExchangeComm.pollAndDispatch", "got " + resp.length + " objects");
                        resp.forEach(function (x) {
                                         if (x.serial && x.serial > self.lastpoll)
                                             self.lastpoll = x.serial;
                                         var content = x.content;
                                         if (content && !self.own_msgids[content.msgid])
                                             self.agents.forEach(function (a) {
                                                                     a.dispatchMessage(content);
                                                                 });
                                     });
                        cont();
                        
                    }
                    //TODO: error
                });



     };
     HTTPExchangeComm.prototype.update = function (cont) {
         var agents = this.agents;
         this.pollAndDispatch(function () {
                                  agents.forEach(function (a) {
                                                     a.updateState(); 
                                                 });
                                  if (cont) 
                                      cont();
                              });
     };
     


function test () {
    var comm1 = new HTTPExchangeComm('http://p2ptrade.btx.udoidio.info/messages');
    var ep1 = new ExchangePeerAgent(new MockWallet(), comm1);
    comm1.addAgent(ep1);
    
    var comm2 = new HTTPExchangeComm('http://p2ptrade.btx.udoidio.info/messages');
    var ep2 = new ExchangePeerAgent(new MockWallet(), comm2);
    comm2.addAgent(ep2);

    var or1 = new MyExchangeOffer(null, {
                                      colorid: "1111",
                                      value: 11
                                  }, {
                                      colorid: "2222",
                                      value: 22
                                  });
    var or2 = new MyExchangeOffer(null, {
                                      colorid: "2222",
                                      value: 22
                                  }, {
                                      colorid: "1111",
                                      value: 11
                                  }, false);
    ep1.registerMyOffer(or1);
    ep2.registerMyOffer(or2);
    var i = 0;
    var intr = 0;
    intr = window.setInterval(function () {
                                  comm1.update();
                                  comm2.update();
                                  i = i + 1;
                                  if (i > 10)
                                      window.clearInterval(intr);
                              }, 1000);
    
}

//test();

