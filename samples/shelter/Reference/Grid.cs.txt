using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

public class Grid
{
    private float size;
    private GameObject cube;
    private GameObject grid;
    private Vector3 startPO;
    private int currentObjects = 0;
    private Dictionary<Vector2Int, GameObject> occupiedPositions = new Dictionary<Vector2Int, GameObject>();
    private int generationDepth;
    private float scale;

    public Grid(float size, Vector3 startPO, GameObject cube, int generationDepth, float scale)
    {
        this.startPO = startPO;
        this.size = size;
        this.cube = cube;
        this.scale = scale;
        this.generationDepth = generationDepth;
        grid = new GameObject("Grid");

        Transform initialTransform = CreateObjectAtPosition(startPO, cube, 0);
        if (initialTransform != null)
        {
            Iteration(initialTransform);
        }

        makeBuild(Vector3.zero);
    }

    private Transform CreateObjectAtPosition(Vector3 gridPosition, GameObject cube, int index)
    {
        Vector2Int gridCoord = GetGridCoordinate(gridPosition);

        if (!IsValidPosition(gridCoord))
        {
            return null;
        }

        Vector3 correctedPosition = GetWorldPosition(gridCoord);

        GameObject newCube = InstantiateCube(cube, correctedPosition, index);
        occupiedPositions[gridCoord] = newCube;

        currentObjects++;
        return newCube.transform;
    }

    private void Iteration(Transform startTran)
    {
        Queue<Transform> queue = new Queue<Transform>();
        queue.Enqueue(startTran);

        int[,] directions = new int[,]
        {
            { 0, 1 }, { 1, 0 }, { 0, -1 }, { -1, 0 },
            { -1, 1 }, { -1, -1 }, { 1, 1 }, { 1, -1 }
        };

        while (queue.Count > 0 && currentObjects < Mathf.Pow(2 * generationDepth + 1, 2))
        {
            Transform currentTran = queue.Dequeue();

            for (int i = 0; i < directions.GetLength(0); i++)
            {
                Vector3 position = new Vector3(
                    currentTran.position.x + directions[i, 0] * size,
                    currentTran.position.y + directions[i, 1] * size,
                    0
                );

                int index = GetIndexFromPosition(position);
                Transform newCubeTransform = CreateObjectAtPosition(position, this.cube, index);

                if (newCubeTransform != null)
                {
                    queue.Enqueue(newCubeTransform);
                }

                if (currentObjects >= Mathf.Pow(2 * generationDepth + 1, 2))
                {
                    break;
                }
            }
        }
    }

    private int GetIndexFromPosition(Vector3 position)
    {
        Vector2Int gridCoord = GetGridCoordinate(position);
        return Mathf.Max(Mathf.Abs(gridCoord.x), Mathf.Abs(gridCoord.y));
    }

    public void setValue(Vector3 po)
    {

        Vector2Int gridCoord = GetGridCoordinate(po);

        if (occupiedPositions.TryGetValue(gridCoord, out GameObject cube))
        {
            SetupBuildUI(cube, GetWorldPosition(gridCoord));
        }
    }


    public void makeBuild(Vector3 vector3)
    {
        Vector3 po = vector3 / (float)(20 / 1.5);
        Vector2Int gridCoord = GetGridCoordinate(po);
        if (occupiedPositions.TryGetValue(gridCoord, out GameObject cube) && cube.transform.childCount == 0)
        {
            int x = GetIndexFromPosition(cube.transform.position);
            InstantiateBuild(cube, x);
        }
    }

    private int getNum(int x, Transform transform) => CalculateResourceCost(x, transform, false);

    private int getNewNum(int x, Transform transform) => CalculateResourceCost(x, transform, true);

    private Vector2Int GetGridCoordinate(Vector3 position)
    {
        int x = Mathf.RoundToInt((position.x - startPO.x) / size);
        int y = Mathf.RoundToInt((position.y - startPO.y) / size);
        return new Vector2Int(x, y);
    }

    private bool IsValidPosition(Vector2Int gridCoord)
    {
        return gridCoord.x >= -generationDepth && gridCoord.x <= generationDepth &&
               gridCoord.y >= -generationDepth && gridCoord.y <= generationDepth &&
               !occupiedPositions.ContainsKey(gridCoord);
    }

    private Vector3 GetWorldPosition(Vector2Int gridCoord)
    {
        return new Vector3(gridCoord.x * size + startPO.x, gridCoord.y * size + startPO.y, 0);
    }

    private GameObject InstantiateCube(GameObject cube, Vector3 position, int index)
    {
        GameObject newCube = Object.Instantiate(cube, position, Quaternion.identity, grid.transform);
        newCube.transform.localScale = new Vector3(scale, scale, scale);
        SpriteRenderer spriteRenderer = newCube.GetComponent<SpriteRenderer>();
        spriteRenderer.sortingOrder = 2;
        spriteRenderer.sprite = GridManager.instance.sprites[index];
        return newCube;
    }

    private GameObject GetCubeAtPosition(Vector3 position)
    {
        foreach (var kvp in occupiedPositions)
        {
            Vector3 cubePosition = GetWorldPosition(kvp.Key);

            float halfSize = size / 2f;
            if (position.x >= cubePosition.x - halfSize && position.x <= cubePosition.x + halfSize &&
                position.y >= cubePosition.y - halfSize && position.y <= cubePosition.y + halfSize)
            {
                return kvp.Value;
            }
        }
        return null;
    }

    private void SetupBuildUI(GameObject cube, Vector3 position)
    {
        GameManager.instance.BuildUi.SetActive(true);

        UIoutline outline = GameManager.instance.BuildUi.GetComponentInChildren<UIoutline>();

        RectTransform uiElement = GameManager.instance.BuildUi.transform.GetChild(1).GetChild(0).GetComponent<RectTransform>();
        Transform h = uiElement.transform.GetChild(0);
        Transform bu = uiElement.transform.GetChild(1);

        bu.GetChild(1).GetComponent<Image>().color = Color.white;

        int x = GridManager.instance.sprites.IndexOf(cube.GetComponent<SpriteRenderer>().sprite);

        SetupBuildUIElements(h, bu, x);

        // 使用网格坐标计算UI元素位置
        Vector2Int gridCoord = GetGridCoordinate(position);
        uiElement.localPosition = new Vector3(gridCoord.x * size, gridCoord.y * size, 0) * (float)((size * 10 + (size / 2 - 0.2) * 10) / size);

        outline.Blink();
    }

    private void SetupBuildUIElements(Transform h, Transform bu, int x)
    {
        h.GetComponent<Image>().sprite = GridManager.instance.Buildsprites[x];
        h.GetChild(0).GetComponent<Text>().text = h.GetComponent<Image>().sprite.name;

        h.GetChild(1).GetComponentInChildren<Text>().text = "0";
        h.GetChild(2).GetComponentInChildren<Text>().text = "0";

        h.GetChild(1).GetComponentInChildren<Text>().color = Color.white;
        h.GetChild(2).GetComponentInChildren<Text>().color = Color.white;

        int num = x == 1 ? getNum(5, GridManager.instance.Builds[x].transform) : getNum(2, GridManager.instance.Builds[x].transform);

        if ((x == 1 && num > GameManager.instance.woodNum) || (x == 2 && num > GameManager.instance.RockNum))
        {
            h.GetChild(x).GetComponentInChildren<Text>().color = Color.red;
            bu.GetChild(1).GetComponent<Image>().color = Color.red;
        }

        if (x != 0) {
            h.GetChild(x).GetComponentInChildren<Text>().text = num.ToString();
        }
    }

    private void InstantiateBuild(GameObject cube, int x)
    {
        GameObject h = Object.Instantiate(GridManager.instance.Builds[x], cube.transform.position, Quaternion.identity, cube.transform);
        h.transform.localScale = Vector3.one;

        if (x !=0) {
            if (x == 1)
            {
                GameManager.instance.woodNum -= getNewNum(5, h.transform);
            }
            else
            {
                GameManager.instance.RockNum -= getNewNum(2, h.transform);
            }
        }
    }

    private int CalculateResourceCost(int x, Transform transform, bool isNew)
    {
        int count = GetSameObjectCount(transform);
        if (count == 0) return 1;
        if (count == 1) return isNew ? 1 : 2;

        int a = 1, b = 2, temp = 0;
        for (int i = 0; i < count - (isNew ? 2 : 1); i++)
        {
            temp = (a + b) * x;
            a = b;
            b = temp;
        }

        return temp;
    }

    private int GetSameObjectCount(Transform transform)
    {
        return Object.FindObjectsOfType<GameObject>().Count(obj => obj.name.Contains(transform.name));
    }
}