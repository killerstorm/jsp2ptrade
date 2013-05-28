var comm = null;
var epa = null;

var color1 = "1111";
var color2 = "2222";

function updateGUIstate () {
    var active = epa.hasActiveEP();
    var text = "";
    if (active) {
        text = "Transaction in progress: " + epa.active_ep.state;
        
    }

    $("#status").text(text);
}

$(function () {
      comm = new HTTPExchangeComm('http://p2ptrade.btx.udoidio.info/messages');
      epa = new ExchangePeerAgent(new MockWallet(), comm);
      comm.addAgent(epa);
      window.setInterval(function () {
                             comm.update();
                             updateGUIstate();
                         }, 2000);

      $('#buy-button').click(
          function () {
              epa.registerMyOffer( 
                  new MyExchangeOffer(null, {
                                          colorid: color1,
                                          value: 11
                                      }, {
                                          colorid: color2,
                                          value: 22
                                      }));
          });

      $('#sell-button').click(
          function () {
              epa.registerMyOffer( 
                  new MyExchangeOffer(null, {
                                          colorid: color2,
                                          value: 22
                                      }, {
                                          colorid: color1,
                                          value: 11
                                      }));
          });
      
      
              
});