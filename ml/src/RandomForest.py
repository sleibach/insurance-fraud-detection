import joblib
import matplotlib.pyplot as plt

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import RocCurveDisplay, PrecisionRecallDisplay, roc_auc_score, classification_report, accuracy_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from imblearn.over_sampling import SMOTE
from sklearn.pipeline import Pipeline

from dataLoader import loadExcel, prepareData, getPreprocessor

EXCEL_PATH = "../data/fraud_oracle.xlsx"
MODEL_PATH = "../models/rfc_fraud_model.pkl"

def loadClassifier(path):
    return joblib.load(path)

def saveClassifier(rfc, path):
    joblib.dump(rfc, path)

def trainRF(train):

    X_train = prepareData(train)
    y_train = train["FraudFound_P"].values
    preprocessor = getPreprocessor()

    X_train = preprocessor.fit_transform(X_train)

    print(f"Fraud cases: {sum(y_train)}")
    print(f"No fraud cases: {len(y_train) - sum(y_train)}")
    print(f"Fraud percentage: {100 * sum(y_train) / len(y_train):.2f}%")

    smote = SMOTE(random_state=0, k_neighbors=min(5, sum(y_train)))
    X_train_balanced, y_train_balanced = smote.fit_resample(X_train, y_train)
    
    param_grid = {
        'n_estimators': [20, 50, 100, 200],
        'max_depth': [1, 3, 5, 7, None],
        'min_samples_split': [2, 3, 5, 10],
        'max_features': ['sqrt', 'log2'],
        'class_weight': ['balanced', 'balanced_subsample']
    }
    
    grid_search = GridSearchCV(
        RandomForestClassifier(random_state=0),
        param_grid,      
        cv=StratifiedKFold(n_splits=3, shuffle=True, random_state=0),
        scoring='recall',      
        n_jobs=-1,
        verbose=1           
    )
    
    grid_search.fit(X_train_balanced, y_train_balanced)
    
    print(f"Best parameters: {grid_search.best_params_}")
    print(f"Best CV score: {grid_search.best_score_:.4f}")
    
    pipeline = Pipeline([
        ('preprocessor', preprocessor),
        ('classifier', grid_search.best_estimator_)
    ])
    
    return pipeline

def evaluateRF(val, rfc):
    X_val = prepareData(val)
    y_val = val["FraudFound_P"].values
    
    predictions = rfc.predict(X_val)
    probs = rfc.predict_proba(X_val)[:, 1]
    
    print(f"ROC AUC: {roc_auc_score(y_val, probs):.4f}")
    print(f"Accuracy: {accuracy_score(y_val, predictions):.4f}")
    print(classification_report(y_val, predictions, zero_division=0))

def visualizeRF_PrecisionRecallCurve(test, rfc): 

    X_test = prepareData(test)
    y_Test = test["FraudFound_P"].values

    display = PrecisionRecallDisplay.from_estimator(
        rfc, X_test, y_Test, name="RFC", plot_chance_level=True, despine=True
    )
    _ = display.ax_.set_title("2-class Precision-Recall curve")
    
    plt.show()

def visualizeRF_ROCCurve(test, rfc): 

    X_test = prepareData(test)
    y_Test = test["FraudFound_P"].values

    rfc_disp = RocCurveDisplay.from_estimator(rfc, X_test, y_Test, plot_chance_level=True) 
    plt.show()

def predict_rfc(data):
    rfc_pipeline = loadClassifier(MODEL_PATH)

    predictions = rfc_pipeline.predict(data)
    probs = rfc_pipeline.predict_proba(data)[:, 1]

    return predictions, probs

if __name__ == "__main__":

    train, test, val = loadExcel(EXCEL_PATH)

    #rfc_pipeline = trainRF(train)
    #saveClassifier(rfc_pipeline, MODEL_PATH)
    rfc_pipeline = loadClassifier(MODEL_PATH)

    evaluateRF(val, rfc_pipeline)
    visualizeRF_ROCCurve(test, rfc_pipeline)