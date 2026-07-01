sap.ui.define([
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Image",
    "sap/m/ScrollContainer",
    "claims/ext/formatter/pipeline"
], function (Dialog, Button, Image, ScrollContainer, pipelineFormatter) {
    "use strict";

    var oDialog;
    var oPreviewImage;

    function getAttachment(oEvent) {
        var oSource = oEvent.getSource();
        var oContext = oSource.getBindingContext();
        return oContext && oContext.getObject();
    }

    function ensureDialog() {
        if (oDialog) {
            return oDialog;
        }

        oPreviewImage = new Image({
            decorative: false,
            densityAware: false,
            width: "auto",
            height: "auto"
        }).addStyleClass("claimsAttachmentPreviewDialogImage");

        oDialog = new Dialog({
            stretch: true,
            contentWidth: "100%",
            contentHeight: "100%",
            endButton: new Button({
                text: "Close",
                press: function () {
                    oDialog.close();
                }
            }),
            content: new ScrollContainer({
                width: "100%",
                height: "100%",
                horizontal: true,
                vertical: true,
                content: oPreviewImage
            })
        });

        return oDialog;
    }

    return {
        onPress: function (oEvent) {
            var oAttachment = getAttachment(oEvent);
            if (!oAttachment) {
                return;
            }

            var sSource = pipelineFormatter.attachmentPreviewSrc(
                oAttachment.claim_ID,
                oAttachment.ID,
                oAttachment.mediaType
            );

            if (!sSource) {
                return;
            }

            var oPreviewDialog = ensureDialog();
            oPreviewDialog.setTitle(oAttachment.filename || "");
            oPreviewImage.setAlt(oAttachment.filename || "");
            oPreviewImage.setSrc(sSource);
            oPreviewDialog.open();
        }
    };
});
