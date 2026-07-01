sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (ControllerExtension, Fragment, JSONModel, MessageToast, MessageBox) {
    "use strict";

    // Catalog of selectable pipeline models. Keys must match the backend model
    // identifiers (srv/code/utils/runConfig.ts): predict models map to tracks via
    // classifyPredictModel, evaluator models via classifyEvalModel.
    var PREDICT_CATALOG = [
        { key: "sap-rpt-1-large", text: "SAP RPT-1 Large — proprietary" },
        { key: "gbc",            text: "Gradient Boosting — custom ML" },
        { key: "rf",             text: "Random Forest — custom ML" },
        { key: "svm",            text: "Support Vector Machine — custom ML" },
        { key: "lr",             text: "Logistic Regression — custom ML" },
        { key: "knn",            text: "k-Nearest Neighbors — custom ML" },
        { key: "nb",             text: "Naive Bayes — custom ML" }
    ];

    var EVAL_CATALOG = [
        { key: "anthropic--claude-4.6-opus", text: "Claude 4.6 Opus — proprietary" },
        { key: "gpt-oss-120b",               text: "GPT-OSS 120B — open source" },
        { key: "gpt-oss-20b",                text: "GPT-OSS 20B — open source" },
        { key: "gemma-3-27b",                text: "Gemma 3 27B — open source" }
    ];

    // Default two-track configuration (mirrors DEFAULT_PREDICT_MODELS /
    // DEFAULT_EVALUATIONS in srv/code/utils/runConfig.ts).
    var DEFAULT_PREDICT_MODELS = ["sap-rpt-1-large", "gbc"];
    var DEFAULT_EVALUATIONS = [
        { model: "anthropic--claude-4.6-opus", inputPredictModel: "sap-rpt-1-large" },
        { model: "gpt-oss-120b",               inputPredictModel: "gbc" }
    ];

    // Build the {key,text} choices for the "Input Prediction" dropdown from the
    // currently selected predict models (labels taken from PREDICT_CATALOG).
    function buildPredictChoices(aSelectedKeys) {
        return (aSelectedKeys || []).map(function (sKey) {
            var oHit = PREDICT_CATALOG.filter(function (c) { return c.key === sKey; })[0];
            return { key: sKey, text: oHit ? oHit.text : sKey };
        });
    }

    function cloneDefaults(aArr) {
        return aArr.map(function (o) {
            return (typeof o === "object") ? Object.assign({}, o) : o;
        });
    }

    return ControllerExtension.extend("claims.ext.controller.ListReportExt", {

        // Opens the "Submit Claim" input dialog. Referenced from manifest.json via
        // controlConfiguration -> @UI.LineItem -> actions -> SubmitClaim.press
        // (".extension.claims.ext.controller.ListReportExt.onSubmitClaim").
        onSubmitClaim: function () {
            var oView = this.base.getView();

            if (!this._pSubmitDialog) {
                this._pSubmitDialog = Fragment.load({
                    id: oView.getId() + "--submitClaimDialog",
                    name: "claims.ext.fragment.SubmitClaimDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }

            this._pSubmitDialog.then(function (oDialog) {
                oDialog.setModel(new JSONModel({
                    externalRef: "",
                    rawText: "",
                    actualFraudSelection: "unknown",
                    attachments: [],
                    // Advanced pipeline configuration (pre-filled with defaults).
                    predictCatalog: PREDICT_CATALOG,
                    evalCatalog: EVAL_CATALOG,
                    predictModels: cloneDefaults(DEFAULT_PREDICT_MODELS),
                    predictChoices: buildPredictChoices(DEFAULT_PREDICT_MODELS),
                    evaluations: cloneDefaults(DEFAULT_EVALUATIONS)
                }), "submit");
                oDialog.open();
            });
        },

        // Keep the "Input Prediction" choices and existing evaluation rows in sync
        // when the set of selected prediction models changes.
        onPredictModelsChange: function () {
            this._pSubmitDialog.then(function (oDialog) {
                var oModel = oDialog.getModel("submit");
                var aPredict = oModel.getProperty("/predictModels") || [];
                var aChoices = buildPredictChoices(aPredict);
                oModel.setProperty("/predictChoices", aChoices);

                // Repair evaluation rows whose input prediction is no longer selected.
                var sFallback = aPredict[0] || "";
                var aEvals = (oModel.getProperty("/evaluations") || []).map(function (e) {
                    var bValid = aPredict.indexOf(e.inputPredictModel) >= 0;
                    return {
                        model: e.model,
                        inputPredictModel: bValid ? e.inputPredictModel : sFallback
                    };
                });
                oModel.setProperty("/evaluations", aEvals);
            });
        },

        // Add an empty evaluation row, defaulting its input to the first prediction.
        onAddEvaluation: function () {
            this._pSubmitDialog.then(function (oDialog) {
                var oModel = oDialog.getModel("submit");
                var aEvals = (oModel.getProperty("/evaluations") || []).slice();
                var aPredict = oModel.getProperty("/predictModels") || [];
                aEvals.push({ model: "", inputPredictModel: aPredict[0] || "" });
                oModel.setProperty("/evaluations", aEvals);
            });
        },

        // Remove the evaluation row bound to the pressed button.
        onRemoveEvaluation: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("submit");
            if (!oCtx) { return; }
            var oModel = oCtx.getModel();
            var iIndex = parseInt(oCtx.getPath().split("/").pop(), 10);
            var aEvals = (oModel.getProperty("/evaluations") || []).slice();
            aEvals.splice(iIndex, 1);
            oModel.setProperty("/evaluations", aEvals);
        },

        // Read selected files as base64 and append to submit>/attachments.
        onAttachmentsChange: function (oEvent) {
            var aFiles = oEvent.getParameter("files") || [];
            if (!aFiles.length) { return; }

            this._pSubmitDialog.then(function (oDialog) {
                var oModel = oDialog.getModel("submit");
                var aAttachments = (oModel.getProperty("/attachments") || []).slice();
                var iPending = aFiles.length;

                var fnDone = function () {
                    iPending -= 1;
                    if (iPending === 0) {
                        oModel.setProperty("/attachments", aAttachments);
                        var oUploader = oDialog.byId("submitClaimAttachments");
                        if (oUploader && oUploader.clear) {
                            oUploader.clear();
                        }
                    }
                };

                Array.prototype.forEach.call(aFiles, function (oFile) {
                    var oReader = new FileReader();
                    oReader.onload = function (e) {
                        var sDataUrl = e.target.result || "";
                        var iComma = sDataUrl.indexOf(",");
                        var sBase64 = iComma >= 0 ? sDataUrl.slice(iComma + 1) : sDataUrl;
                        aAttachments.push({
                            filename: oFile.name,
                            mediaType: oFile.type || "application/octet-stream",
                            content: sBase64
                        });
                        fnDone();
                    };
                    oReader.onerror = function () { fnDone(); };
                    oReader.readAsDataURL(oFile);
                });
            });
        },

        // Remove an attachment row from the list.
        onRemoveAttachment: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("submit");
            if (!oCtx) { return; }
            var oModel = oCtx.getModel();
            var iIndex = parseInt(oCtx.getPath().split("/").pop(), 10);
            var aAttachments = (oModel.getProperty("/attachments") || []).slice();
            aAttachments.splice(iIndex, 1);
            oModel.setProperty("/attachments", aAttachments);
        },

        // Confirm button — validates input and invokes the unbound submitClaim action.
        onSubmitConfirm: function () {
            var that = this;
            var oView = this.base.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();

            this._pSubmitDialog.then(function (oDialog) {
                var oData = oDialog.getModel("submit").getData();

                var bHasText = !!(oData.rawText && oData.rawText.trim());
                var bHasAttachments = (oData.attachments || []).length > 0;
                if (!bHasText && !bHasAttachments) {
                    MessageBox.warning(oBundle.getText("SubmitClaimTextOrAttachmentRequired"));
                    return;
                }

                // Normalize the advanced configuration before sending.
                var aPredictModels = (oData.predictModels || []).filter(Boolean);
                if (aPredictModels.length === 0) {
                    MessageBox.warning(oBundle.getText("SubmitClaimPredictModelsRequired"));
                    return;
                }

                var aEvaluations = (oData.evaluations || [])
                    .map(function (e) {
                        return {
                            model: (e.model || "").trim(),
                            inputPredictModel: (e.inputPredictModel || "").trim() || aPredictModels[0]
                        };
                    })
                    .filter(function (e) { return e.model; });

                // Guard against rows left without an evaluator model selected.
                var bHasEmptyEvaluator = (oData.evaluations || []).some(function (e) {
                    return !e.model || !e.model.trim();
                });
                if (bHasEmptyEvaluator) {
                    MessageBox.warning(oBundle.getText("SubmitClaimEvaluatorRequired"));
                    return;
                }

                var oAction = oView.getModel().bindContext("/submitClaim(...)");
                oAction.setParameter("externalRef", oData.externalRef || null);
                oAction.setParameter("rawText", bHasText ? oData.rawText.trim() : null);
                oAction.setParameter("actualFraud", oData.actualFraudSelection === "unknown" ? null : oData.actualFraudSelection === "true");
                oAction.setParameter("attachments", (oData.attachments || []).map(function (a) {
                    return {
                        filename: a.filename,
                        mediaType: a.mediaType,
                        content: a.content
                    };
                }));
                oAction.setParameter("predictModels", aPredictModels);
                oAction.setParameter("evaluations", aEvaluations);

                oDialog.setBusy(true);
                oAction.execute().then(function () {
                    oDialog.setBusy(false);
                    oDialog.close();
                    var oResult = oAction.getBoundContext().getObject();
                    MessageToast.show(oBundle.getText("SubmitClaimSuccess", [oResult.ID]));
                    // Refresh the List Report table so the new claim appears immediately.
                    try {
                        that.base.getExtensionAPI().refresh();
                    } catch (e) {
                        oView.getModel().refresh();
                    }
                }).catch(function (oErr) {
                    oDialog.setBusy(false);
                    MessageBox.error((oErr && oErr.message) || String(oErr));
                });
            });
        },

        // Cancel button — closes the dialog without submitting.
        onSubmitCancel: function () {
            if (this._pSubmitDialog) {
                this._pSubmitDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        }
    });
});
