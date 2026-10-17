using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class CountDown : MonoBehaviour
{
    Dictionary<int, int> Days = new Dictionary<int, int>
    {
        { 0, 1500 },
        { 5, 1500 },
        { 10,1500},
        { 15,1500},
        { 20,1500},
        { 25,1200},
    };

    private const int secondsPerDay = 300; // 300 秒为一天
    private const float secondsPerHour = secondsPerDay / 24f; // 每小时的秒数
    private const float secondsPerMinute = secondsPerHour / 60f; // 每分钟的秒数

    private void OnEnable()
    {
        GameManager.EventWithIng += HandleBroadcastEventWithParam;
    }

    private void OnDisable()
    {
        GameManager.EventWithIng -= HandleBroadcastEventWithParam;
    }

    private void HandleBroadcastEventWithParam(int totalSeconds)
    {
        StartCoroutine(CountdownDown(Days[totalSeconds], transform.GetChild(1).GetComponent<Text>()));
    }

    IEnumerator CountdownDown(int totalSeconds, Text timerText)
    {
        while (totalSeconds > 0)
        {
            // 计算天、小时、分钟和秒数
            int days = totalSeconds / secondsPerDay;
            int hours = (int)((totalSeconds % secondsPerDay) / secondsPerHour);
            int minutes = (int)((totalSeconds % secondsPerHour) / secondsPerMinute);

            // 更新UI文本
            timerText.text = $"{days:D2}:{hours:D2}:{minutes:D2}";

            // 每天过去后打印Debug信息
            if (totalSeconds % secondsPerDay == 0)
            {
                GameManager.instance.NewDays++;
                if (GameManager.instance.NewDays != 1) {
                    GameManager.instance.GetPeopleDayFood();
                }
            }

            // 等待一秒
            yield return new WaitForSeconds(1);

            // 减少totalSeconds
            totalSeconds--;
        }

        // 倒计时结束时，更新为 00:00:00:00
        timerText.text = $"00:00:00";

        GameManager.instance.startRain();


    }
}
