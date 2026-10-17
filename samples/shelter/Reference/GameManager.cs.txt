using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

public enum newState
{
    Loding,
    startLoding,
    NoLoding,
    StopLoding
}

public enum timerState
{
    TimerIng,
    NoIng
}

public class GameManager : MonoBehaviour
{
    [HideInInspector]
    public GameObject DispatchUi;
    [HideInInspector]
    public GameObject FinishUi;
    [HideInInspector]
    public GameObject BuildUi;
    [HideInInspector]
    public GameObject SetUi;
    [HideInInspector]
    public Text food;
    [HideInInspector]
    public Text wood;
    [HideInInspector]
    public Text rock;
    [HideInInspector]
    public Slider stay;
    [HideInInspector]
    public GameObject finalDataUi;
    [HideInInspector]
    public Text DayRduce;
    [HideInInspector]
    public bool Win = false;

    public int woodNum;
    public int RockNum;
    public int pepleNum;
    public int foodNUm;
    [HideInInspector]
    public newState newState;
    [HideInInspector]
    public timerState timerState;

    public static GameManager instance;

    public  int NewDays = 0;

    public  int Defence = 0;

    public static event Action<int> EventWithLoding;
    public static event Action<int> EventWithIng;

    public ParticleSystem Rain;

    private void Awake()
    {

        if (instance != null)
        {
            Destroy(gameObject);
        }
        else
        {
            instance = this;
        }
    }

    void Start()
    {
        Rain.Stop();
        timerState = timerState.NoIng;
        newState = newState.NoLoding;
        stay.onValueChanged.AddListener(OnSliderValueChanged);
        UpdateSliderStep(); // 初始化滑块步长
    }

    void Update()
    {

        if (Input.GetKeyDown(KeyCode.Space)) {

            Time.timeScale++;
            

        }

        if (timerState == timerState.NoIng)
        {
            StartCoroutine(AfterIng(NewDays));
            timerState = timerState.TimerIng;
        }

        if (newState == newState.startLoding)
        {
            int peple = Mathf.CeilToInt(stay.value * Mathf.Min(pepleNum, 29)); // 使用滑块值和最大人数计算

            if (peple != 0 && peple <= pepleNum && peple * 200 <= foodNUm)
            {
                pepleNum -= peple;
                foodNUm -= peple * 200;
                GetNewObejects(peple);
                StartCoroutine(AfterLoding(peple));
                stay.value = 0;

                newState = newState.Loding;
                UpdateSliderStep(); // 更新滑块步长
            }
            else
            {
                stay.value = 0;
                newState = newState.NoLoding;
                UpdateSliderStep(); // 更新滑块步长
            }
        }

        if (newState == newState.StopLoding)
        {
            newState = newState.NoLoding;
            FinishUi.SetActive(true);
        }

        food.text = foodNUm.ToString();
        wood.text = woodNum.ToString();
        rock.text = RockNum.ToString();

        DayRduce.text = $"{pepleNum * 200}/{pepleNum}";
    }

    void OnSliderValueChanged(float value)
    {
        int maxPeplePerSegment = Mathf.Min(pepleNum, 29); // 每个滑块段的最大派遣人数
        int peple = Mathf.CeilToInt(value * maxPeplePerSegment); // 根据滑块值计算派遣人数
        int foodCost = peple * 200; // 计算食物消耗量

        stay.transform.GetChild(3).GetComponent<Text>().text = $"派遣人数:{peple}"; 
        stay.transform.GetChild(4).GetComponent<Text>().text = $"需要消耗食物:{foodCost}";
    }

    void UpdateSliderStep()
    {

        // 动态设置滑块的步长
        if (pepleNum > 0)
        {
            stay.wholeNumbers = false;

            stay.value = 1f / pepleNum;
        }
        else
        {
            stay.value = 0;
        }

        stay.value = 0;
    }

    private IEnumerator AfterLoding(int x)
    {
        yield return null;
        EventWithLoding?.Invoke(x * 8 + 50);
    }

    private IEnumerator AfterIng(int x)
    {
        yield return null;
        EventWithIng?.Invoke(x);
    }

    int FinilyNum , WodNum , RocNum;
    void GetNewObejects(int x)
    {

        int AllObejects = (int)((x * NewDays * 0.8 * (x * 8 + 50)) / 0.7);

         WodNum = (int)(AllObejects * 0.2);
         RocNum = AllObejects - WodNum;

        int losePeople = x < 29 ? 1 : 0;

        int getPeople = x < 29 ? 2 : 1;

        FinilyNum = pepleNum + x - losePeople + getPeople;

        Transform reduce = FinishUi.transform.GetChild(0).GetChild(0);
        Transform add = FinishUi.transform.GetChild(0).GetChild(1);

        reduce.GetChild(0).GetComponent<Text>().text =  $"人员损耗:{losePeople}";
        reduce.GetChild(1).GetComponent<Text>().text = $"食物消耗:{losePeople * 200}";

        add.GetChild(0).GetComponentInChildren<Text>().text = WodNum.ToString();
        add.GetChild(1).GetComponentInChildren<Text>().text = RocNum.ToString();
        add.GetChild(2).GetComponentInChildren<Text>().text = getPeople.ToString();
    }

    public void addNewObeject()
    {
        FinishUi.SetActive(false);
        woodNum += WodNum;
        RockNum += RocNum;
        pepleNum = FinilyNum;
        UpdateSliderStep(); // 更新滑块步长
    }





    public void startRain()
    {

        StartCoroutine(ControlGravityParticleSystem());
    }

    Dictionary<int, int[,]> InquadationData = new Dictionary<int, int[,]>
{
    { 5, new int[,] { { 8100, 40000,1} } },
    { 10, new int[,] { { 16200, 80000,2} } },
    { 15, new int[,] { { 36800, 162540,3} } },
    { 20, new int[,] { { 48000, 216540,3} } },
    { 25, new int[,] { { 59200, 270540,3} } },
    { 29, new int[,] { { 68160, 313740,3} } }
};


     void Inquadation() {

        string text = "";

        if (NewDays < 29) {
            int foodData = InquadationData[NewDays][0, 0]; // 访问第一个元素

            int denfenceData = InquadationData[NewDays][0, 1]; // 访问第一个元素

            if (foodNUm >= foodData && Defence >= denfenceData)
            {
                GameObject[] walls = GetObjects("Wall");

                GameObject[] foods = GetObjects("FoodMaker");

                for (int i = 0; i < InquadationData[NewDays][0, 2];i++) {

                    Destroy(walls[UnityEngine.Random.Range(0, walls.Length)]);

                    Destroy(foods[UnityEngine.Random.Range(0, foods.Length)]);

                }

                Win = true;

                text = $"恭喜你撑过去了风暴";

            }
            else
            {
                Win = false;

                text = $"你存活了{NewDays}天"; 


            }
        }
        else {

            Win = false;

            text = $"恭喜过关";

        }

        finalDataUi.GetComponentInChildren<Text>().text = text;

        finalDataUi.SetActive(true);

        Time.timeScale = 0;


    }

    GameObject[] GetObjects(string nameSubstring)
    {
        // 查找所有带有 Maker 脚本的对象并过滤出名字包含指定字符串的对象
        return GameObject.FindObjectsOfType<Maker>()
                     .Where(obj => obj.gameObject.name.Contains(nameSubstring))
                     .Select(obj => obj.gameObject)
                     .ToArray();
    }

    public void GetPeopleDayFood() {
        foodNUm -= pepleNum * 200;
    }


    public float activeTime = 5f;

    // 逐渐停止的持续时间
    public float fadeOutTime = 2f;

    public float RainBeforTime = 2f;

    IEnumerator ControlGravityParticleSystem()
    {

        yield return new WaitForSeconds(RainBeforTime);

        var emission = Rain.emission;
        var main = Rain.main;

        emission.rateOverTime = 150f;
        main.gravityModifier = 5;

        // 启动粒子系统
        Rain.Play();

        // 让粒子系统持续运行指定的时间
        yield return new WaitForSeconds(activeTime);

        // 逐渐减少发射率和重力

        // 保存初始发射率和重力
        float initialRate = emission.rateOverTime.constant;
        float initialGravity = main.gravityModifier.constant;

        // 开始逐渐减少发射率和重力
        for (float t = 0; t < fadeOutTime; t += Time.deltaTime)
        {
            // 插值计算新的发射率和重力
            float newRate = Mathf.Lerp(initialRate, 0f, t / fadeOutTime);
            float newGravity = Mathf.Lerp(initialGravity, 0f, t / fadeOutTime);

            // 更新发射率和重力
            emission.rateOverTime = newRate;
            var gravity = main.gravityModifier;
            gravity = newGravity;

            yield return null;  // 等待下一帧
        }

        // 完全停止发射
        emission.rateOverTime = 0f;

        // 停止粒子系统
        Rain.Stop();

        Inquadation();

    }


 
}
