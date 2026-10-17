using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Maker : MonoBehaviour
{
    public float moveSpeed; 
    public int totalSeconds;
    // Start is called before the first frame update
    void Start()
    {
        if (transform.name.Contains("FoodMaker")) {
            StartCoroutine(foodMade());
        }
        else {
            StartCoroutine(defenseMade());
        }
            
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    IEnumerator foodMade() {

        Text text = transform.GetChild(0).GetChild(0).GetComponent<Text>();

        Vector3 startPosition = text.transform.position;
        Vector3 endPosition = text.transform.GetChild(0).position;

        Color color = text.color;

        while (true) // Infinite loop to keep repeating
        {
           
            int x = 0;
            while (x <= 60)
            {
                yield return new WaitForSeconds(1f);
                x++;
            }

            int num = GameManager.instance.NewDays * 20 * 3 + 3;
            text.text = $"+{num}";
            yield return new WaitForSeconds(0.2f); // Delay before restarting the loop
            text.gameObject.SetActive(true);

            float elapsedTime = 0f;
            color.a = 1f; // Set alpha to fully opaque
            text.color = color;

            while (elapsedTime < totalSeconds)
            {

                float t = elapsedTime / totalSeconds; // Normalize time to [0, 1]

                color = text.color;
                color.a = (1 - t); // Gradually fade out
                text.color = color;

                text.transform.position = Vector3.Lerp(startPosition, endPosition, t);

                // Wait for the next frame
                yield return null;

                // Increase elapsed time
                elapsedTime += Time.deltaTime * moveSpeed;
            }

            text.gameObject.SetActive(false);
            text.transform.position = startPosition;

            GameManager.instance.foodNUm += num;

        }

    }

    IEnumerator defenseMade()
    {

        Text text = transform.GetChild(0).GetChild(0).GetComponent<Text>();

        Vector3 startPosition = text.transform.position;
        Vector3 endPosition = text.transform.GetChild(0).position;

        Color color = text.color;

        while (true) // Infinite loop to keep repeating
        {

            int x = 0;
            while (x <= 60)
            {
                yield return new WaitForSeconds(1f);
                x++;
            }

            int num = (int)(GameManager.instance.NewDays * 200 * 0.7) + 200;
            text.text = $"+{num}";
            yield return new WaitForSeconds(0.2f); // Delay before restarting the loop
            text.gameObject.SetActive(true);

            float elapsedTime = 0f;
            color.a = 1f; // Set alpha to fully opaque
            text.color = color;

            while (elapsedTime < totalSeconds)
            {

                float t = elapsedTime / totalSeconds; // Normalize time to [0, 1]

                color = text.color;
                color.a = (1 - t); // Gradually fade out
                text.color = color;

                text.transform.position = Vector3.Lerp(startPosition, endPosition, t);

                // Wait for the next frame
                yield return null;

                // Increase elapsed time
                elapsedTime += Time.deltaTime * moveSpeed;
            }

            text.gameObject.SetActive(false);
            text.transform.position = startPosition;

            GameManager.instance.Defence += num;

        }

    }


}
