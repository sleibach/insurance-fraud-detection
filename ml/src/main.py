import pandas as pd

from fastapi import FastAPI
from pydantic import BaseModel

from dataLoader import prepareData
from RandomForest import predict_rfc
from SupportVectorMachine import predict_svm
from LogisticRegression import predict_lr
from KNearestNeighbours import predict_knn
from NaiveBayes import predict_nb
from GradientBoost import predict_gbc

app = FastAPI(
    title="ML_API",
    description="",
    version="1.0.0"
)

class dataRecord(BaseModel):
    Month: str	
    WeekOfMonth: int	
    DayOfWeek: str	
    Make: str	
    AccidentArea: str	
    DayOfWeekClaimed: str	
    MonthClaimed: str	
    WeekOfMonthClaimed: int
    Sex: str	
    MaritalStatus: str	
    Age: int	
    Fault: str	
    PolicyType: str	
    VehicleCategory: str	
    VehiclePrice: str		
    PolicyNumber: int	
    RepNumber: int
    Deductible: int	
    DriverRating: int
    Days_Policy_Accident: str	
    Days_Policy_Claim: str	
    PastNumberOfClaims: str	
    AgeOfVehicle: str	
    AgeOfPolicyHolder: str	
    PoliceReportFiled: bool	
    WitnessPresent: bool	
    AgentType: str	
    NumberOfSuppliments: str	
    AddressChange_Claim: str	
    NumberOfCars: str	
    Year: int	
    BasePolicy: str

@app.post("/predict/rf")
async def predict_random_forest(record: dataRecord):

    data = pd.DataFrame([record.model_dump()])
    data = prepareData(data)
    predictions, probs = predict_rfc(data)

    return {
        "prediction": predictions[0].item(),
        "probabiltiy": probs[0].item()
    }

@app.post("/predict/svm")
async def predict_support_vector_machine(record: dataRecord):

    data = pd.DataFrame([record.model_dump()])
    data = prepareData(data)
    predictions, probs = predict_svm(data)

    return {
        "prediction": predictions[0].item(),
        "probabiltiy": probs[0].item()
    }

@app.post("/predict/lr")
async def predict_logisitc_regression(record: dataRecord):

    data = pd.DataFrame([record.model_dump()])
    data = prepareData(data)
    predictions, probs = predict_lr(data)

    return {
        "prediction": predictions[0].item(),
        "probabiltiy": probs[0].item()
    }

@app.post("/predict/knn")
async def predict_k_nearest_neighbours(record: dataRecord):

    data = pd.DataFrame([record.model_dump()])
    data = prepareData(data)
    predictions, probs = predict_knn(data)

    return {
        "prediction": predictions[0].item(),
        "probabiltiy": probs[0].item()
    }

@app.post("/predict/nb")
async def predict_naive_bayes(record: dataRecord):

    data = pd.DataFrame([record.model_dump()])
    data = prepareData(data)
    predictions, probs = predict_nb(data)

    return {
        "prediction": predictions[0].item(),
        "probabiltiy": probs[0].item()
    }

@app.post("/predict/gbc")
async def predict_gradient_boost_classifier(record: dataRecord):

    data = pd.DataFrame([record.dict()])
    data = prepareData(data)
    predictions, probs = predict_gbc(data)

    return {
        "prediction": predictions[0].item(),
        "probabiltiy": probs[0].item()
    }