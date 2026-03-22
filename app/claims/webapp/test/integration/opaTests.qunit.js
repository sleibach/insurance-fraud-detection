sap.ui.require(
    [
        'sap/fe/test/JourneyRunner',
        'claims/test/integration/FirstJourney',
		'claims/test/integration/pages/ClaimsList',
		'claims/test/integration/pages/ClaimsObjectPage'
    ],
    function(JourneyRunner, opaJourney, ClaimsList, ClaimsObjectPage) {
        'use strict';
        var JourneyRunner = new JourneyRunner({
            // start index.html in web folder
            launchUrl: sap.ui.require.toUrl('claims') + '/index.html'
        });

       
        JourneyRunner.run(
            {
                pages: { 
					onTheClaimsList: ClaimsList,
					onTheClaimsObjectPage: ClaimsObjectPage
                }
            },
            opaJourney.run
        );
    }
);